"""
FastAPI server for Avatar creation and management
"""

import os
import sys
import shutil
import uuid
import random
import tempfile
import time
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from supabase import create_client, Client

from .models import AvatarCreate, AvatarUpdate, ApiResponse, AgentRequest, AgentResponse, GenerateAvatarResponse
from . import database as db
from .agent_models import (
    InitializeAgentRequest,
    InitializeAgentResponse,
    AgentStateUpdateRequest,
    SentimentUpdateRequest,
    AgentPersonality,
    AgentState,
    AgentActionResponse,
)
from . import agent_database as agent_db
from .agent_worker import process_agent_tick
from . import onboarding
from . import conversation as conv

# Reduce noisy logging from HTTP clients
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("app.agent_worker").setLevel(logging.WARNING)

# Add image_gen to path for importing pipeline
IMAGE_GEN_PATH = Path(__file__).parent.parent.parent / "image_gen"
sys.path.insert(0, str(IMAGE_GEN_PATH))

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    except Exception as e:
        print(f"Failed to initialize Supabase client: {e}")
else:
    print("Warning: SUPABASE_URL or SUPABASE_SERVICE_KEY not set. Storage uploads will fail.")

# Lifespan context manager for startup/shutdown events
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    db.init_db()
    yield
    # Shutdown logic (if any) would go here

app = FastAPI(title="Avatar API", version="1.0.0", lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(onboarding.router)

# ============================================================================
# ROUTES
# ============================================================================

@app.get("/health")
def health_check():
    return {"ok": True, "service": "api"}


@app.post("/agent/decision", response_model=AgentResponse)
def get_agent_decision(req: AgentRequest):
    """
    Get a decision for a robot agent.
    Supports: MOVE, STAND_STILL, REQUEST_CONVERSATION, ACCEPT_CONVERSATION, REJECT_CONVERSATION
    
    Uses the utility-based agent decision system when available.
    Falls back to random behavior if agent system is unavailable.
    """
    
    try:
        # =====================================================================
        # PRIORITY 1: Handle pending conversation requests first
        # =====================================================================
        if req.pending_requests:
            for pending in req.pending_requests:
                initiator_type = pending.get("initiator_type", "PLAYER")
                interest = calculate_ai_interest_to_accept(req.robot_id, pending.get("initiator_id", ""), initiator_type)
                if should_ai_accept(interest):
                    response = {
                        "action": "ACCEPT_CONVERSATION",
                        "request_id": pending.get("request_id")
                    }
                    print(f"AI Decision for {req.robot_id}: {response}")
                    return response
                else:
                    response = {
                        "action": "REJECT_CONVERSATION",
                        "request_id": pending.get("request_id")
                    }
                    print(f"AI Decision for {req.robot_id}: {response}")
                    return response
        
        # =====================================================================
        # PRIORITY 2: Handle active conversation states
        # =====================================================================
        if req.conversation_state == "IN_CONVERSATION":
            response = {"action": "STAND_STILL", "duration": random.uniform(2.0, 5.0)}
            print(f"AI Decision for {req.robot_id}: {response}")
            return response
        
        if req.conversation_state == "WALKING_TO_CONVERSATION":
            response = {"action": "STAND_STILL", "duration": 1.0}
            print(f"AI Decision for {req.robot_id}: {response}")
            return response
        
        if req.conversation_state == "PENDING_REQUEST":
            # Robot has sent a conversation request and is waiting for response
            # Stand still while waiting
            response = {"action": "STAND_STILL", "duration": 1.0}
            print(f"AI Decision for {req.robot_id}: {response}")
            return response
        
        # =====================================================================
        # PRIORITY 3: Try utility-based agent decision system
        # =====================================================================
        agent_response = try_agent_decision_system(req)
        if agent_response:
            return agent_response
        
        # =====================================================================
        # FALLBACK: Random behavior when agent system unavailable
        # =====================================================================
        short_id = req.robot_id[:8]
        print(f"🎲 {short_id} | FALLBACK (lock busy)")
        return get_fallback_decision(req)
        
    except Exception as e:
        print(f"Error in get_agent_decision: {e}")
        return {"action": "STAND_STILL", "duration": 5.0}


def try_agent_decision_system(req: AgentRequest) -> Optional[dict]:
    """
    Try to get a decision from the utility-based agent decision system.
    Returns None if agent system is unavailable or fails.
    """
    client = agent_db.get_supabase_client()
    if not client:
        return None
    
    try:
        # Try to get agent context (this auto-initializes if needed)
        personality = agent_db.get_personality(client, req.robot_id)
        state = agent_db.get_state(client, req.robot_id)
        
        if not personality or not state:
            # Initialize agent with random personality
            try:
                personality, state = agent_db.initialize_agent(client, req.robot_id)
            except Exception as init_err:
                print(f"⚠️  Agent init failed: {init_err}")
                return None
        
        # Call the agent decision system with retry for lock contention
        result = None
        for attempt in range(3):
            result = process_agent_tick(client, req.robot_id, debug=False)
            if result is not None:
                break
            if attempt < 2:  # Don't sleep after last attempt
                time.sleep(0.15)  # 150ms delay between retries
        
        if not result:
            return None
        
        # Map agent system action to API response format
        return map_agent_action_to_response(result, req)
        
    except Exception as e:
        print(f"⚠️  Agent error: {e}")
        return None


def map_agent_action_to_response(result: dict, req: AgentRequest) -> Optional[dict]:
    """Map agent system result to the API response format."""
    action_type = result.get("action", "idle")
    target = result.get("target")
    score = result.get("score", 0)
    state = result.get("state", {})
    
    # Build a concise log line
    short_id = req.robot_id[:8]
    target_name = ""
    if target:
        if target.get("target_type") == "location":
            target_name = f"→ ({target.get('x')},{target.get('y')})"
        elif target.get("target_type") == "avatar":
            target_name = f"→ avatar {target.get('target_id', '')[:8]}"
        elif target.get("x") is not None:
            target_name = f"→ ({target.get('x')},{target.get('y')})"
    
    # State summary
    e = state.get('energy', 0)
    h = state.get('hunger', 0)
    l = state.get('loneliness', 0)
    m = state.get('mood', 0)
    state_str = f"E:{e:.0%} H:{h:.0%} L:{l:.0%} M:{m:.0%}"
    
    print(f"🤖 {short_id} | {action_type:20} {target_name:15} | score:{score:.2f} | {state_str}")
    
    # Map action types to API responses
    if action_type in ["idle", "stand_still"]:
        return {"action": "STAND_STILL", "duration": random.uniform(2.0, 5.0)}
    
    elif action_type == "wander":
        if target and target.get("x") is not None and target.get("y") is not None:
            return {"action": "MOVE", "target_x": target["x"], "target_y": target["y"]}
        return get_random_move_target(req)
    
    elif action_type in ["walk_to_location", "interact_food", "interact_karaoke", "interact_rest"]:
        if target:
            if target.get("x") is not None and target.get("y") is not None:
                return {"action": "MOVE", "target_x": target["x"], "target_y": target["y"]}
            elif target.get("target_id"):
                # Look up location coordinates
                client = agent_db.get_supabase_client()
                if client:
                    locations = agent_db.get_all_world_locations(client)
                    location = next((l for l in locations if l.id == target["target_id"]), None)
                    if location:
                        return {"action": "MOVE", "target_x": location.x, "target_y": location.y}
        return None
    
    elif action_type == "initiate_conversation":
        if target and target.get("target_id"):
            return {"action": "REQUEST_CONVERSATION", "target_entity_id": target["target_id"]}
        # Find a nearby entity to talk to
        if req.nearby_entities:
            for entity in req.nearby_entities:
                if entity.get("kind") in ["PLAYER", "ROBOT"] and entity.get("entityId") != req.robot_id:
                    return {"action": "REQUEST_CONVERSATION", "target_entity_id": entity.get("entityId")}
        return None
    
    elif action_type in ["join_conversation", "leave_conversation"]:
        return {"action": "STAND_STILL", "duration": 1.0}
    
    elif action_type == "move":
        if target and target.get("x") is not None and target.get("y") is not None:
            return {"action": "MOVE", "target_x": target["x"], "target_y": target["y"]}
        return None
    
    print(f"Unknown action type: {action_type}")
    return None


def get_random_move_target(req: AgentRequest) -> dict:
    """Generate a random move target avoiding obstacles."""
    MARGIN = 2
    min_x = MARGIN
    max_x = max(min_x + 1, req.map_width - MARGIN - 2)
    min_y = MARGIN
    max_y = max(min_y + 1, req.map_height - MARGIN - 2)
    
    obstacles = set()
    if req.nearby_entities:
        for entity in req.nearby_entities:
            ex, ey = entity.get("x", -1), entity.get("y", -1)
            for dx in range(2):
                for dy in range(2):
                    obstacles.add((ex + dx, ey + dy))
    
    target_x, target_y = random.randint(min_x, max_x), random.randint(min_y, max_y)
    
    for _ in range(100):
        is_blocked = any((target_x + dx, target_y + dy) in obstacles for dx in range(2) for dy in range(2))
        if not is_blocked:
            break
        target_x = random.randint(min_x, max_x)
        target_y = random.randint(min_y, max_y)
    
    return {"action": "MOVE", "target_x": target_x, "target_y": target_y}


def get_fallback_decision(req: AgentRequest) -> dict:
    """Fallback decision logic when agent system is unavailable."""
    # Check if we should initiate a conversation with nearby entities
    if req.nearby_entities:
        for entity in req.nearby_entities:
            if entity.get("kind") in ["PLAYER", "ROBOT"] and entity.get("entityId") != req.robot_id:
                interest = calculate_ai_interest_to_initiate(req.robot_id, entity.get("entityId", ""), entity.get("kind", "ROBOT"))
                if should_ai_initiate(interest):
                    response = {"action": "REQUEST_CONVERSATION", "target_entity_id": entity.get("entityId")}
                    print(f"AI Decision (FALLBACK) for {req.robot_id}: {response}")
                    return response
    
    # Small chance to stand still
    if random.random() < 0.1:
        response = {"action": "STAND_STILL", "duration": random.uniform(2.0, 8.0)}
        print(f"AI Decision (FALLBACK) for {req.robot_id}: {response}")
        return response
    
    # Default: random walk
    response = get_random_move_target(req)
    print(f"AI Decision (FALLBACK) for {req.robot_id}: {response}")
    return response
    

# ============================================================================
# AI INTEREST CALCULATIONS (Enhanced with Agent System)
# ============================================================================

def calculate_ai_interest_to_initiate(robot_id: str, target_id: str, target_type: str) -> float:
    """
    Calculate AI interest score for initiating a conversation.
    Uses agent personality and social memory if available, falls back to random.
    """
    try:
        client = agent_db.get_supabase_client()
        if client:
            # Try to use the new agent system
            personality = agent_db.get_personality(client, robot_id)
            state = agent_db.get_state(client, robot_id)
            memory = agent_db.get_social_memory(client, robot_id, target_id)
            
            if personality and state:
                # Base interest from personality
                base = personality.sociability * 0.5
                
                # Boost from loneliness
                if state.loneliness > 0.5:
                    base += (state.loneliness - 0.5) * 0.4
                
                # Modify by social memory
                if memory:
                    base += memory.sentiment * 0.2
                    base += memory.familiarity * 0.1
                
                # Prefer players
                if target_type == "PLAYER":
                    base += 0.2
                
                return max(0.0, min(1.0, base))
    except Exception as e:
        print(f"Using fallback interest calculation: {e}")
    
    # Fallback to simple random
    base = 0.3
    variance = 0.2
    return max(0, min(1, base + (random.random() - 0.5) * 2 * variance))


def calculate_ai_interest_to_accept(robot_id: str, initiator_id: str, initiator_type: str = "PLAYER") -> float:
    """
    Calculate AI interest in accepting a conversation request.
    Uses agent personality if available.
    """
    if initiator_type == "PLAYER":
        return 1.0  # Always accept humans
    
    try:
        client = agent_db.get_supabase_client()
        if client:
            personality = agent_db.get_personality(client, robot_id)
            memory = agent_db.get_social_memory(client, robot_id, initiator_id)
            
            if personality:
                # Base from agreeableness
                base = personality.agreeableness * 0.6 + 0.3
                
                # Modify by social memory
                if memory:
                    base += memory.sentiment * 0.2
                    # Negative sentiment might lead to rejection
                    if memory.sentiment < -0.3:
                        base -= 0.3
                
                return max(0.0, min(1.0, base))
    except Exception as e:
        print(f"Using fallback accept calculation: {e}")
    
    # Fallback
    base = 0.5
    variance = 0.2
    return max(0, min(1, base + (random.random() - 0.5) * 2 * variance))


def should_ai_initiate(interest_score: float) -> bool:
    """Decide if AI should initiate conversation based on interest score."""
    return random.random() < interest_score


def should_ai_accept(interest_score: float) -> bool:
    """Decide if AI should accept conversation based on interest score."""
    return random.random() < interest_score


@app.get("/avatars", response_model=ApiResponse)
def list_avatars():
    """List all avatars"""
    avatars = db.get_all_avatars()
    return {"ok": True, "data": avatars}


@app.get("/avatars/{avatar_id}", response_model=ApiResponse)
def get_avatar(avatar_id: str):
    """Get single avatar by ID"""
    avatar = db.get_avatar_by_id(avatar_id)
    if not avatar:
        raise HTTPException(status_code=404, detail="Avatar not found")
    return {"ok": True, "data": avatar}


@app.post("/avatars", response_model=ApiResponse, status_code=201)
def create_avatar(avatar: AvatarCreate):
    """Create a new avatar"""
    new_avatar = db.create_avatar(
        name=avatar.name,
        color=avatar.color,
        bio=avatar.bio
    )
    return {"ok": True, "data": new_avatar}


@app.patch("/avatars/{avatar_id}", response_model=ApiResponse)
def update_avatar(avatar_id: str, avatar: AvatarUpdate):
    """Update avatar fields"""
    updated = db.update_avatar(
        avatar_id,
        name=avatar.name,
        color=avatar.color,
        bio=avatar.bio
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Avatar not found")
    return {"ok": True, "data": updated}


@app.post("/avatars/{avatar_id}/sprite", response_model=ApiResponse)
async def upload_sprite(avatar_id: str, sprite: UploadFile = File(...)):
    """Upload sprite image for avatar to Supabase Storage"""
    if not supabase:
        raise HTTPException(status_code=503, detail="Storage service unavailable")

    avatar = db.get_avatar_by_id(avatar_id)
    if not avatar:
        raise HTTPException(status_code=404, detail="Avatar not found")
    
    # Validate file type
    allowed_types = ["image/png", "image/jpeg", "image/gif", "image/webp"]
    if sprite.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Invalid file type")
    
    # Generate filename
    ext = Path(sprite.filename).suffix if sprite.filename else ".png"
    filename = f"{avatar_id}-{uuid.uuid4()}{ext}"
    
    # Read file content
    try:
        file_content = await sprite.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}")

    # Upload to Supabase
    bucket_name = "sprites"
    try:
        # Check if bucket exists, if not create it? 
        # Usually buckets are created manually or via migrations.
        # We assume 'sprites' bucket exists and is public.
        
        supabase.storage.from_(bucket_name).upload(
            path=filename,
            file=file_content,
            file_options={"content-type": sprite.content_type, "upsert": "false"}
        )
        
        # Get Public URL
        public_url = supabase.storage.from_(bucket_name).get_public_url(filename)
        
    except Exception as e:
        print(f"Supabase Upload Error: {e}")
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")
    
    # Update database
    updated = db.update_avatar_sprite(avatar_id, public_url)
    return {"ok": True, "data": updated}


@app.delete("/avatars/{avatar_id}", response_model=ApiResponse)
def delete_avatar(avatar_id: str):
    """Delete avatar"""
    avatar = db.get_avatar_by_id(avatar_id)
    if not avatar:
        raise HTTPException(status_code=404, detail="Avatar not found")
    
    # Optional: Delete from Supabase Storage?
    # Keeping it simple for now, just deleting DB record.
    
    db.delete_avatar(avatar_id)
    return {"ok": True, "message": "Avatar deleted"}


@app.post("/generate-avatar", response_model=GenerateAvatarResponse)
async def generate_avatar(photo: UploadFile = File(...)):
    """
    Generate avatar sprites from an uploaded photo.
    
    Accepts a photo, generates 4 directional views (front, back, left, right)
    using AI image generation, and uploads them to Supabase storage.
    
    Returns URLs to the generated images.
    """
    if not supabase:
        raise HTTPException(status_code=503, detail="Storage service unavailable")
    
    # Validate file type
    allowed_types = ["image/png", "image/jpeg", "image/jpg", "image/webp"]
    if photo.content_type not in allowed_types:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid file type: {photo.content_type}. Allowed: {allowed_types}"
        )
    
    # Create a unique session ID for this generation
    session_id = str(uuid.uuid4())
    
    try:
        # Import the pipeline (done here to defer loading)
        from pipeline import run_pipeline
        
        # Create temp directory for processing
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # Save uploaded file temporarily
            input_path = temp_path / f"input_{session_id}.png"
            file_content = await photo.read()
            with open(input_path, "wb") as f:
                f.write(file_content)
            
            print(f"[generate-avatar] Processing image for session {session_id}")
            
            # Run the sprite generation pipeline
            output_folder = temp_path / "output"
            results = run_pipeline(
                input_image_path=str(input_path),
                output_folder=str(output_folder)
            )
            
            print(f"[generate-avatar] Pipeline complete, uploading to Supabase...")
            
            # Upload all views to Supabase (sprites bucket)
            # Each generation creates a new folder with the session_id, preserving old uploads
            bucket_name = "sprites"
            image_urls = {}
            
            # Views to upload: front, back, left, right
            views = ["front", "back", "left", "right"]
            
            for view in views:
                view_path = results["views"].get(view)
                if not view_path or not Path(view_path).exists():
                    print(f"[generate-avatar] Warning: {view} view not found at {view_path}")
                    continue
                
                # Read the generated image
                with open(view_path, "rb") as f:
                    image_bytes = f.read()
                
                # Generate unique filename
                filename = f"{session_id}/{view}.png"
                
                # Upload to Supabase
                try:
                    supabase.storage.from_(bucket_name).upload(
                        path=filename,
                        file=image_bytes,
                        file_options={"content-type": "image/png", "upsert": "true"}
                    )
                    
                    # Get public URL
                    public_url = supabase.storage.from_(bucket_name).get_public_url(filename)
                    image_urls[view] = public_url
                    print(f"[generate-avatar] Uploaded {view}: {public_url}")
                    
                except Exception as upload_error:
                    print(f"[generate-avatar] Upload error for {view}: {upload_error}")
                    # Try to create the bucket if it doesn't exist
                    if "not found" in str(upload_error).lower():
                        try:
                            supabase.storage.create_bucket(bucket_name, options={"public": True})
                            print(f"[generate-avatar] Created bucket: {bucket_name}")
                            # Retry upload
                            supabase.storage.from_(bucket_name).upload(
                                path=filename,
                                file=image_bytes,
                                file_options={"content-type": "image/png", "upsert": "true"}
                            )
                            public_url = supabase.storage.from_(bucket_name).get_public_url(filename)
                            image_urls[view] = public_url
                            print(f"[generate-avatar] Uploaded {view}: {public_url}")
                        except Exception as retry_error:
                            print(f"[generate-avatar] Retry failed: {retry_error}")
                            raise HTTPException(status_code=500, detail=f"Storage upload failed: {retry_error}")
                    else:
                        raise HTTPException(status_code=500, detail=f"Storage upload failed: {upload_error}")
            
            if not image_urls:
                raise HTTPException(status_code=500, detail="No images were generated")
            
            print(f"[generate-avatar] Successfully generated avatar: {session_id}")
            
            return {
                "ok": True,
                "message": f"Avatar generated successfully with {len(image_urls)} views",
                "images": image_urls
            }
            
    except ImportError as e:
        print(f"[generate-avatar] Import error: {e}")
        raise HTTPException(
            status_code=500, 
            detail="Image generation pipeline not available. Check dependencies."
        )
    except Exception as e:
        print(f"[generate-avatar] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# AGENT DECISION SYSTEM ENDPOINTS
# ============================================================================

@app.post("/agent/{avatar_id}/action", response_model=AgentActionResponse)
def get_next_agent_action(avatar_id: str, debug: bool = False):
    """
    Get the next action for an agent.
    
    Call this when an agent is free/done with their current action
    to determine what they should do next.
    
    This is the on-demand decision endpoint - agents request their
    next action when ready, rather than being batch-processed.
    """
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    result = process_agent_tick(client, avatar_id, debug=debug)
    if result:
        return AgentActionResponse(
            ok=True,
            avatar_id=avatar_id,
            action=result["action"],
            target=result.get("target"),
            score=result.get("score"),
            state=result.get("state")
        )
    else:
        raise HTTPException(status_code=404, detail="Avatar not found or context unavailable")


@app.post("/agent/initialize", response_model=InitializeAgentResponse)
def initialize_agent(request: InitializeAgentRequest):
    """
    Initialize agent data (personality and state) for an avatar.
    
    Call this when a new avatar is created to set up their AI agent.
    """
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    try:
        personality, state = agent_db.initialize_agent(
            client, 
            request.avatar_id,
            request.personality
        )
        return InitializeAgentResponse(
            ok=True,
            avatar_id=request.avatar_id,
            personality=personality,
            state=state
        )
    except Exception as e:
        print(f"Error initializing agent: {e}")
        return InitializeAgentResponse(
            ok=False,
            avatar_id=request.avatar_id,
            error=str(e)
        )


@app.get("/agent/{avatar_id}/personality")
def get_agent_personality(avatar_id: str):
    """Get personality data for an avatar."""
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    personality = agent_db.get_personality(client, avatar_id)
    if not personality:
        raise HTTPException(status_code=404, detail="Personality not found")
    
    return {"ok": True, "data": personality.model_dump()}


@app.get("/agent/{avatar_id}/state")
def get_agent_state(avatar_id: str):
    """Get current state (needs) for an avatar."""
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    state = agent_db.get_state(client, avatar_id)
    if not state:
        raise HTTPException(status_code=404, detail="State not found")
    
    return {"ok": True, "data": state.model_dump()}


@app.patch("/agent/{avatar_id}/state")
def update_agent_state(avatar_id: str, request: AgentStateUpdateRequest):
    """Manually update agent state (for testing or admin purposes)."""
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    state = agent_db.get_state(client, avatar_id)
    if not state:
        raise HTTPException(status_code=404, detail="State not found")
    
    # Apply updates
    if request.energy is not None:
        state.energy = max(0.0, min(1.0, request.energy))
    if request.hunger is not None:
        state.hunger = max(0.0, min(1.0, request.hunger))
    if request.loneliness is not None:
        state.loneliness = max(0.0, min(1.0, request.loneliness))
    if request.mood is not None:
        state.mood = max(-1.0, min(1.0, request.mood))
    
    agent_db.update_state(client, state)
    return {"ok": True, "data": state.model_dump()}


@app.get("/agent/{avatar_id}/social-memory")
def get_agent_social_memory(avatar_id: str):
    """Get all social memories for an avatar."""
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    memories = agent_db.get_social_memories(client, avatar_id)
    return {"ok": True, "data": [m.model_dump() for m in memories]}


@app.post("/agent/sentiment")
def update_sentiment(request: SentimentUpdateRequest):
    """
    Update sentiment after a conversation.
    
    Called by the server after conversations complete.
    """
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    try:
        memory = agent_db.update_social_memory(
            client,
            request.from_avatar_id,
            request.to_avatar_id,
            sentiment_delta=request.sentiment_delta,
            familiarity_delta=request.familiarity_delta,
            conversation_topic=request.conversation_topic
        )
        return {"ok": True, "data": memory.model_dump()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/world/locations")
def get_world_locations():
    """Get all world locations."""
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    locations = agent_db.get_all_world_locations(client)
    return {"ok": True, "data": [l.model_dump() for l in locations]}


@app.get("/agent/{avatar_id}/context")
def get_agent_context(avatar_id: str):
    """
    Get the full decision context for an avatar (for debugging).
    
    This shows everything the agent considers when making a decision.
    """
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    context = agent_db.build_agent_context(client, avatar_id)
    if not context:
        raise HTTPException(status_code=404, detail="Avatar not found")
    
    return {
        "ok": True,
        "data": {
            "avatar_id": context.avatar_id,
            "position": {"x": context.x, "y": context.y},
            "personality": context.personality.model_dump(),
            "state": context.state.model_dump(),
            "nearby_avatars": [a.model_dump() for a in context.nearby_avatars],
            "world_locations": [l.model_dump() for l in context.world_locations],
            "active_cooldowns": context.active_cooldowns,
            "in_conversation": context.in_conversation,
            "social_memories_count": len(context.social_memories),
        }
    }


# ============================================================================
# CONVERSATION CHAT ENDPOINTS
# ============================================================================

@app.post("/conversation/agent-respond")
def agent_respond(request: conv.AgentRespondRequest):
    """
    Generate an AI agent's response to a chat message.
    
    Called by the realtime server when a player sends a message to an offline agent.
    """
    try:
        response = conv.generate_agent_response(
            agent_id=request.agent_id,
            partner_id=request.partner_id,
            partner_name=request.partner_name,
            message=request.message,
            conversation_history=request.conversation_history
        )
        return conv.AgentRespondResponse(ok=True, response=response)
    except Exception as e:
        print(f"Error in agent-respond: {e}")
        return conv.AgentRespondResponse(ok=False, error=str(e))


@app.post("/conversation/analyze-message")
def analyze_message(request: conv.MessageSentimentRequest):
    """
    Analyze a single message for sentiment and apply real-time mood updates.
    
    Called after each message to:
    - Detect rude/positive messages
    - Update receiver's mood immediately if message is rude/positive
    - Update social memory sentiment
    
    This enables real-time mood changes during conversations.
    """
    try:
        result = conv.process_message_sentiment(
            message=request.message,
            sender_id=request.sender_id,
            sender_name=request.sender_name,
            receiver_id=request.receiver_id,
            receiver_name=request.receiver_name
        )
        return conv.MessageSentimentResponse(
            ok=True,
            sender_mood_change=result.get("sender_mood_change", 0),
            receiver_mood_change=result.get("receiver_mood_change", 0),
            sentiment=result.get("sentiment", 0),
            is_rude=result.get("is_rude", False),
            is_positive=result.get("is_positive", False)
        )
    except Exception as e:
        print(f"Error in analyze-message: {e}")
        return conv.MessageSentimentResponse(ok=False)


@app.post("/conversation/end-process")
def end_process(request: conv.ConversationEndRequest):
    """
    Process a conversation after it ends.
    
    Updates sentiment, mood, energy, and creates memory records.
    Called by the realtime server when a conversation ends.
    """
    print(f"[API] /conversation/end-process called")
    print(f"[API] Participants: {request.participant_a_name} ({request.participant_a[:8]}...) & {request.participant_b_name} ({request.participant_b[:8]}...)")
    print(f"[API] Transcript length: {len(request.transcript)} messages")
    print(f"[API] Online status: A={request.participant_a_is_online}, B={request.participant_b_is_online}")
    
    try:
        result = conv.process_conversation_end(
            conversation_id=request.conversation_id,
            participant_a=request.participant_a,
            participant_b=request.participant_b,
            participant_a_name=request.participant_a_name,
            participant_b_name=request.participant_b_name,
            transcript=request.transcript,
            participant_a_is_online=request.participant_a_is_online,
            participant_b_is_online=request.participant_b_is_online
        )
        print(f"[API] /conversation/end-process completed: {result}")
        return conv.ConversationEndResponse(**result)
    except Exception as e:
        import traceback
        print(f"[API] Error in end-process: {e}")
        traceback.print_exc()
        return conv.ConversationEndResponse(ok=False, error=str(e))


@app.post("/conversation/get-or-create")
def get_or_create_conversation(participant_a: str, participant_b: str):
    """Get or create a conversation between two participants."""
    conversation_id = conv.get_or_create_conversation(participant_a, participant_b)
    if conversation_id:
        return {"ok": True, "conversation_id": conversation_id}
    return {"ok": False, "error": "Failed to get/create conversation"}


@app.post("/conversation/{conversation_id}/message")
def add_message(conversation_id: str, sender_id: str, sender_name: str, content: str):
    """Add a message to an active conversation."""
    message = conv.add_message_to_conversation(conversation_id, sender_id, sender_name, content)
    if message:
        return {"ok": True, "message": message}
    return {"ok": False, "error": "Failed to add message"}


@app.get("/conversation/{conversation_id}/transcript")
def get_transcript(conversation_id: str):
    """Get the transcript of a conversation."""
    transcript = conv.get_conversation_transcript(conversation_id)
    return {"ok": True, "transcript": transcript}


# ============================================================================
# AGENT MONITORING ENDPOINTS
# ============================================================================

@app.get("/agents/all")
def get_all_agents():
    """
    Get all agents with their current state and last action.
    Used for the agent monitoring sidebar.
    """
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    try:
        # Get all agent states
        states_resp = client.table("agent_state").select("*").execute()
        states = {s["avatar_id"]: s for s in (states_resp.data or [])}
        
        # Get all agent personalities
        personalities_resp = client.table("agent_personality").select("*").execute()
        personalities = {p["avatar_id"]: p for p in (personalities_resp.data or [])}
        
        # Get user positions to get display names and current positions
        positions_resp = client.table("user_positions").select(
            "user_id, display_name, x, y, is_online, conversation_state"
        ).execute()
        positions = {p["user_id"]: p for p in (positions_resp.data or [])}
        
        # Get latest decision for each agent
        decisions_resp = client.table("agent_decisions").select(
            "avatar_id, selected_action, action_result, tick_timestamp"
        ).order("tick_timestamp", desc=True).execute()
        
        # Group by avatar_id and take first (most recent)
        latest_decisions = {}
        for d in (decisions_resp.data or []):
            if d["avatar_id"] not in latest_decisions:
                latest_decisions[d["avatar_id"]] = d
        
        # Combine all data
        agents = []
        for avatar_id, state in states.items():
            position = positions.get(avatar_id, {})
            personality = personalities.get(avatar_id, {})
            decision = latest_decisions.get(avatar_id, {})
            
            agents.append({
                "avatar_id": avatar_id,
                "display_name": position.get("display_name", "Unknown"),
                "position": {"x": position.get("x", 0), "y": position.get("y", 0)},
                "is_online": position.get("is_online", False),
                "conversation_state": position.get("conversation_state"),
                "state": {
                    "energy": state.get("energy", 0.5),
                    "hunger": state.get("hunger", 0.5),
                    "loneliness": state.get("loneliness", 0.5),
                    "mood": state.get("mood", 0.5),
                },
                "personality": {
                    "sociability": personality.get("sociability", 0.5),
                    "curiosity": personality.get("curiosity", 0.5),
                    "agreeableness": personality.get("agreeableness", 0.5),
                },
                "current_action": decision.get("selected_action", "idle"),
                "last_action_time": decision.get("tick_timestamp"),
            })
        
        return {"ok": True, "data": agents}
        
    except Exception as e:
        print(f"Error fetching all agents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3003)
