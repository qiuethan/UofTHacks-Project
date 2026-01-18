"""
FastAPI server for Avatar creation and management
"""

import os
import sys
import json
import uuid
import random
import tempfile
import time
import logging
import re
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from supabase import create_client, Client

from .models import AvatarCreate, AvatarUpdate, ApiResponse, AgentRequest, AgentResponse, GenerateAvatarResponse
from . import database as db
from .agent_models import (
    InitializeAgentRequest,
    InitializeAgentResponse,
    AgentStateUpdateRequest,
    SentimentUpdateRequest,
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
                request_id = pending.get("request_id")
                initiator_id = pending.get("initiator_id", "")
                expires_at = pending.get("expires_at")
                # Note: initiator_type and created_at also available if needed
                
                # Check if request is about to expire (within 1 second) - auto-decline
                current_time = time.time() * 1000  # Convert to milliseconds
                if expires_at and current_time >= expires_at - 1000:
                    response = {
                        "action": "REJECT_CONVERSATION",
                        "request_id": request_id,
                        "reason": "Request timed out - didn't respond in time"
                    }
                    print(f"AI Decision for {req.robot_id}: AUTO-DECLINE (timeout) {response}")
                    return response
                
                # Use the intelligent decision system for accept/decline
                # Get agent and initiator display names for context
                client = agent_db.get_supabase_client()
                agent_name = req.robot_id[:8]
                initiator_name = initiator_id[:8]
                
                if client:
                    agent_pos = agent_db.get_avatar_position(client, req.robot_id)
                    initiator_pos = agent_db.get_avatar_position(client, initiator_id)
                    if agent_pos:
                        agent_name = agent_pos.get("display_name", agent_name)
                    if initiator_pos:
                        initiator_name = initiator_pos.get("display_name", initiator_name)
                
                # Use the conversation decision system to decide accept/decline
                decision_result = conv.decide_accept_conversation(
                    agent_id=req.robot_id,
                    agent_name=agent_name,
                    requester_id=initiator_id,
                    requester_name=initiator_name
                )
                
                should_accept = decision_result.get("should_accept", True)
                reason = decision_result.get("reason", "")
                
                if should_accept:
                    response = {
                        "action": "ACCEPT_CONVERSATION",
                        "request_id": request_id,
                        "reason": reason
                    }
                    print(f"AI Decision for {req.robot_id}: ACCEPT - {reason}")
                    return response
                else:
                    response = {
                        "action": "REJECT_CONVERSATION",
                        "request_id": request_id,
                        "reason": reason
                    }
                    print(f"AI Decision for {req.robot_id}: DECLINE - {reason}")
                    return response
        
        # =====================================================================
        # PRIORITY 2: Handle active conversation states
        # =====================================================================
        if req.conversation_state == "IN_CONVERSATION":
            # Stay in conversation briefly then check again
            response = {"action": "STAND_STILL", "duration": 0.5}
            print(f"AI Decision for {req.robot_id}: {response}")
            return response
        
        if req.conversation_state == "WALKING_TO_CONVERSATION":
            # Very brief check while walking
            response = {"action": "STAND_STILL", "duration": 0.3}
            print(f"AI Decision for {req.robot_id}: {response}")
            return response
        
        if req.conversation_state == "PENDING_REQUEST":
            # Very brief wait while request is pending
            response = {"action": "STAND_STILL", "duration": 0.3}
            print(f"AI Decision for {req.robot_id}: {response}")
            return response
        
        # =====================================================================
        # PRIORITY 2.5: Check if agent is busy with a location activity
        # =====================================================================
        client = agent_db.get_supabase_client()
        if client:
            state = agent_db.get_state(client, req.robot_id)
            if state and state.action_expires_at:
                expires_at = state.action_expires_at
                if isinstance(expires_at, str):
                    from datetime import datetime
                    expires_at = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                if expires_at.tzinfo:
                    expires_at = expires_at.replace(tzinfo=None)
                
                from datetime import datetime
                now = datetime.utcnow()
                current_action = state.current_action or 'idle'
                
                # Walking actions should NOT block - agent needs to keep moving!
                # Only actual activities (interact_*) should lock the agent in place
                is_activity = current_action.startswith('interact_')
                
                if now < expires_at and is_activity:
                    # Agent is busy with an activity - keep standing still
                    remaining = (expires_at - now).total_seconds()
                    duration = min(remaining, 5.0)  # Check again in 5s or when done
                    target_name = ""
                    if state.current_action_target:
                        target_name = state.current_action_target.get("name", "")
                    short_id = req.robot_id[:8]
                    
                    # Format activity name nicely for logging
                    activity_display = {
                        'interact_food': '🍽️  EATING',
                        'interact_rest': '😴 RESTING',
                        'interact_karaoke': '🎤 SINGING',
                        'interact_social_hub': '💬 SOCIALIZING',
                        'interact_wander_point': '🧭 EXPLORING',
                    }.get(current_action, f'📍 {current_action}')
                    
                    print(f"🔒 {short_id} | {activity_display} at '{target_name}' - {remaining:.0f}s left")
                    # Even during activities, keep check duration very short
                    return {"action": "STAND_STILL", "duration": min(duration, 1.0)}
        
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
        # On error, check conversation state first
        if req.conversation_state and req.conversation_state != "IDLE":
            return {"action": "STAND_STILL", "duration": 0.5}
        # Otherwise try to move somewhere
        return get_fallback_decision(req)


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
    state = result.get("state", {})
    
    # Build a concise log line
    short_id = req.robot_id[:8]
    target_name = ""
    if target:
        if target.get("target_type") == "location":
            loc_name = target.get("name", "")
            if loc_name:
                target_name = f"→ '{loc_name}' ({target.get('x')},{target.get('y')})"
            else:
                target_name = f"→ ({target.get('x')},{target.get('y')})"
        elif target.get("target_type") == "avatar":
            target_name = f"→ avatar {target.get('target_id', '')[:8]}"
        elif target.get("x") is not None:
            target_name = f"→ ({target.get('x')},{target.get('y')})"
    
    # State summary
    ene = state.get('energy', 0)
    hun = state.get('hunger', 0)
    lon = state.get('loneliness', 0)
    moo = state.get('mood', 0)
    state_str = f"E:{ene:.0%} H:{hun:.0%} L:{lon:.0%} M:{moo:.0%}"
    
    # Use nicer names for activities - these will show in logs
    action_display = {
        'interact_food': '🍽️  EATING',
        'interact_rest': '😴 RESTING',
        'interact_karaoke': '🎤 SINGING',
        'interact_social_hub': '💬 SOCIALIZING',
        'interact_wander_point': '🧭 EXPLORING',
        'walk_to_location': '🚶 WALKING',
        'wander': '🚶 WANDERING',
        'initiate_conversation': '💬 WANTS_TO_TALK',
        'idle': '⏸️  IDLE',
    }.get(action_type, action_type)
    
    print(f"🤖 {short_id} | {action_display:20} {target_name} | {state_str}")
    
    # Map action types to API responses
    if action_type in ["idle", "stand_still"]:
        # Don't stand still - wander instead!
        return get_random_move_target(req)
    
    elif action_type == "wander":
        if target and target.get("x") is not None and target.get("y") is not None:
            return {"action": "MOVE", "target_x": target["x"], "target_y": target["y"]}
        return get_random_move_target(req)
    
    elif action_type == "walk_to_location":
        # Walking to a location - just move there
        if target:
            if target.get("x") is not None and target.get("y") is not None:
                return {"action": "MOVE", "target_x": target["x"], "target_y": target["y"]}
            elif target.get("target_id"):
                # Look up location coordinates
                client = agent_db.get_supabase_client()
                if client:
                    locations = agent_db.get_all_world_locations(client)
                    location = next((loc for loc in locations if loc.id == target["target_id"]), None)
                    if location:
                        return {"action": "MOVE", "target_x": location.x, "target_y": location.y}
        return None
    
    elif action_type in ["interact_food", "interact_karaoke", "interact_rest", "interact_social_hub", "interact_wander_point"]:
        # Interacting with a location - stand still for the remaining duration
        # Use duration from agent worker if available, otherwise look up from location
        duration = result.get("duration_seconds")
        
        if duration is None or duration <= 0:
            # Try to get the actual location duration
            duration = 30  # Default
            if target and target.get("target_id"):
                client = agent_db.get_supabase_client()
                if client:
                    locations = agent_db.get_all_world_locations(client)
                    location = next((loc for loc in locations if loc.id == target["target_id"]), None)
                    if location:
                        duration = location.duration_seconds
        
        # The activity was already logged by agent_worker, just return response
        # Keep durations short - agents should be active
        return {"action": "STAND_STILL", "duration": min(float(duration), 1.0)}
    
    elif action_type == "initiate_conversation":
        if target and target.get("target_id"):
            return {"action": "REQUEST_CONVERSATION", "target_entity_id": target["target_id"]}
        # Find a nearby entity to talk to - only target IDLE entities to prevent group chats
        if req.nearby_entities:
            for entity in req.nearby_entities:
                if entity.get("kind") in ["PLAYER", "ROBOT"] and entity.get("entityId") != req.robot_id:
                    # Only target IDLE entities
                    target_state = entity.get("conversationState", "IDLE")
                    if target_state and target_state != "IDLE":
                        continue  # Skip - entity is busy
                    return {"action": "REQUEST_CONVERSATION", "target_entity_id": entity.get("entityId")}
        return None
    
    elif action_type in ["join_conversation", "leave_conversation"]:
        # Very brief pause then do something else
        return {"action": "STAND_STILL", "duration": 0.3}
    
    elif action_type == "avoid_avatar":
        # Move away from disliked avatar
        if target and target.get("x") is not None and target.get("y") is not None:
            return {"action": "MOVE", "target_x": target["x"], "target_y": target["y"]}
        return None
    
    elif action_type == "move":
        if target and target.get("x") is not None and target.get("y") is not None:
            return {"action": "MOVE", "target_x": target["x"], "target_y": target["y"]}
        return None
    
    print(f"Unknown action type: {action_type}")
    return None


def get_random_move_target(req: AgentRequest) -> dict:
    """
    Generate a move target with social bias - moving towards liked entities
    and away from disliked ones, with some randomness.
    """
    import math
    
    MARGIN = 2
    min_x = MARGIN
    max_x = max(min_x + 1, req.map_width - MARGIN - 1)
    min_y = MARGIN
    max_y = max(min_y + 1, req.map_height - MARGIN - 1)
    
    current_x = req.x if req.x else (max_x // 2)
    current_y = req.y if req.y else (max_y // 2)
    
    # Calculate social influence from nearby entities
    social_dx = 0.0
    social_dy = 0.0
    total_weight = 0.0
    
    if req.nearby_entities:
        client = agent_db.get_supabase_client()
        
        for entity in req.nearby_entities:
            if entity.get("kind") not in ["PLAYER", "ROBOT"]:
                continue
            if entity.get("entityId") == req.robot_id:
                continue
                
            ex = entity.get("x", current_x)
            ey = entity.get("y", current_y)
            
            # Calculate direction to entity
            dx = ex - current_x
            dy = ey - current_y
            distance = max(1, math.sqrt(dx**2 + dy**2))
            dx_norm = dx / distance
            dy_norm = dy / distance
            
            # Get sentiment if possible
            sentiment = 0.0
            if client:
                memory = agent_db.get_social_memory(client, req.robot_id, entity.get("entityId", ""))
                if memory:
                    sentiment = memory.sentiment
                else:
                    # Unknown person - slight attraction (curiosity)
                    sentiment = 0.1
            
            # Distance weight (closer = more influence)
            distance_weight = 1.0 / (1.0 + distance * 0.1)
            
            # Sentiment determines direction
            influence = sentiment * distance_weight
            
            social_dx += dx_norm * influence
            social_dy += dy_norm * influence
            total_weight += abs(influence)
    
    # Normalize social influence
    if total_weight > 0:
        social_dx /= total_weight
        social_dy /= total_weight
        
        # Scale to reasonable distance
        social_magnitude = math.sqrt(social_dx**2 + social_dy**2)
        if social_magnitude > 0:
            social_dx = (social_dx / social_magnitude) * 10
            social_dy = (social_dy / social_magnitude) * 10
    
    # Random component
    random_angle = random.uniform(0, 2 * math.pi)
    random_distance = random.uniform(5, 15)
    random_dx = math.cos(random_angle) * random_distance
    random_dy = math.sin(random_angle) * random_distance
    
    # Blend social (60%) and random (40%) influences
    if total_weight > 0:
        final_dx = social_dx * 0.6 + random_dx * 0.4
        final_dy = social_dy * 0.6 + random_dy * 0.4
    else:
        final_dx = random_dx
        final_dy = random_dy
    
    # Calculate target
    target_x = int(current_x + final_dx)
    target_y = int(current_y + final_dy)
    
    # Clamp to bounds
    target_x = max(min_x, min(max_x, target_x))
    target_y = max(min_y, min(max_y, target_y))
    
    # Avoid obstacles (entities are 1x1)
    obstacles = set()
    if req.nearby_entities:
        for entity in req.nearby_entities:
            ex, ey = entity.get("x", -1), entity.get("y", -1)
            obstacles.add((ex, ey))  # 1x1 entity occupies single cell
    
    for _ in range(100):
        is_blocked = (target_x, target_y) in obstacles  # 1x1 entity check
        if not is_blocked:
            break
        # Try a slightly different random position if blocked
        target_x = int(current_x + random.uniform(-10, 10))
        target_y = int(current_y + random.uniform(-10, 10))
        target_x = max(min_x, min(max_x, target_x))
        target_y = max(min_y, min(max_y, target_y))
    
    return {"action": "MOVE", "target_x": target_x, "target_y": target_y}


def get_fallback_decision(req: AgentRequest) -> dict:
    """Fallback decision logic when agent system is unavailable."""
    # First check if agent is in any conversation state - don't try to start new ones
    if req.conversation_state and req.conversation_state != "IDLE":
        return {"action": "STAND_STILL", "duration": 0.5}
    
    # Check if we should initiate a conversation with nearby entities
    # Only initiate if target is IDLE (prevents group chats)
    if req.nearby_entities:
        for entity in req.nearby_entities:
            if entity.get("kind") in ["PLAYER", "ROBOT"] and entity.get("entityId") != req.robot_id:
                # Only target IDLE entities to prevent group chats
                target_state = entity.get("conversationState", "IDLE")
                if target_state and target_state != "IDLE":
                    continue  # Skip - entity is busy
                interest = calculate_ai_interest_to_initiate(req.robot_id, entity.get("entityId", ""), entity.get("kind", "ROBOT"))
                if should_ai_initiate(interest):
                    response = {"action": "REQUEST_CONVERSATION", "target_entity_id": entity.get("entityId")}
                    print(f"AI Decision (FALLBACK) for {req.robot_id}: {response}")
                    return response
    
    # NEVER stand still - always be moving or doing something!
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


@app.get("/conversation/active/{user_id}")
def get_active_conversation(user_id: str):
    """
    Get the active (not ended) conversation for a user.
    
    Returns the conversation details including transcript if found.
    Used when a player takes over their agent to load conversation history.
    """
    try:
        client = agent_db.get_supabase_client()
        if not client:
            return {"ok": False, "error": "Database unavailable"}
        
        # Find active conversation where user is a participant and not ended
        result = client.table("conversations").select(
            "id, participant_a, participant_b, active_transcript, created_at"
        ).or_(
            f"participant_a.eq.{user_id},participant_b.eq.{user_id}"
        ).is_("ended_at", "null").order("created_at", desc=True).limit(1).execute()
        
        if result.data and len(result.data) > 0:
            conv_data = result.data[0]
            transcript = conv_data.get("active_transcript", []) or []
            partner_id = conv_data["participant_b"] if conv_data["participant_a"] == user_id else conv_data["participant_a"]
            
            # Get partner display name
            partner_result = client.table("avatars").select("display_name").eq("id", partner_id).limit(1).execute()
            partner_name = partner_result.data[0]["display_name"] if partner_result.data else "Unknown"
            
            return {
                "ok": True,
                "conversation_id": conv_data["id"],
                "partner_id": partner_id,
                "partner_name": partner_name,
                "messages": [
                    {
                        "id": f"db-{i}-{msg.get('timestamp', 0)}",
                        "senderId": msg.get("senderId", msg.get("sender_id", "")),
                        "senderName": msg.get("senderName", msg.get("sender_name", "Unknown")),
                        "content": msg.get("content", ""),
                        "timestamp": msg.get("timestamp", 0)
                    }
                    for i, msg in enumerate(transcript)
                ],
                "message_count": len(transcript)
            }
        
        return {"ok": False, "not_found": True}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"ok": False, "error": str(e)}


@app.post("/conversation/should-accept")
def should_accept_conversation(request: conv.AcceptConversationRequest):
    """
    Decide whether an agent should accept a conversation request.
    
    Based on:
    - Social memory sentiment (negative = reject)
    - Agent's current mood and energy
    - Familiarity with the requester
    
    If no prior relationship, defaults to accepting.
    """
    try:
        result = conv.decide_accept_conversation(
            agent_id=request.agent_id,
            agent_name=request.agent_name,
            requester_id=request.requester_id,
            requester_name=request.requester_name
        )
        return conv.AcceptConversationResponse(
            ok=True,
            should_accept=result.get("should_accept", True),
            reason=result.get("reason")
        )
    except Exception as e:
        print(f"Error in should-accept: {e}")
        return conv.AcceptConversationResponse(ok=False, should_accept=True)


@app.post("/conversation/should-initiate")
def should_initiate_conversation(request: conv.InitiateConversationRequest):
    """
    Decide whether an agent should initiate a conversation.
    
    Based on:
    - Social memory sentiment (positive = want to talk)
    - Agent's current mood, energy, and loneliness
    - Familiarity with the target
    - Shared interests
    
    Returns whether to initiate and a personalized reason/greeting.
    """
    try:
        result = conv.decide_initiate_conversation(
            agent_id=request.agent_id,
            agent_name=request.agent_name,
            target_id=request.target_id,
            target_name=request.target_name
        )
        return conv.InitiateConversationResponse(
            ok=True,
            should_initiate=result.get("should_initiate", False),
            reason=result.get("reason")
        )
    except Exception as e:
        print(f"Error in should-initiate: {e}")
        return conv.InitiateConversationResponse(ok=False, should_initiate=False)


@app.post("/conversation/should-end")
def should_end_conversation(request: conv.ShouldEndConversationRequest):
    """
    Decide whether an agent should end a conversation.
    
    LLM analyzes:
    - Conversation flow (natural ending point?)
    - Sentiment of recent messages
    - Agent's personality and mood
    - Length of conversation
    
    Returns decision and optional farewell message.
    """
    try:
        result = conv.decide_end_conversation(
            agent_id=request.agent_id,
            agent_name=request.agent_name,
            partner_id=request.partner_id,
            partner_name=request.partner_name,
            conversation_history=request.conversation_history,
            last_message=request.last_message
        )
        return conv.ShouldEndConversationResponse(
            ok=True,
            should_end=result.get("should_end", False),
            farewell_message=result.get("farewell_message"),
            reason=result.get("reason")
        )
    except Exception as e:
        print(f"Error in should-end: {e}")
        return conv.ShouldEndConversationResponse(ok=False, should_end=False)


# ============================================================================
# RELATIONSHIP STATS ENDPOINT
# ============================================================================

@app.get("/relationship/{from_id}/{to_id}")
def get_relationship(from_id: str, to_id: str):
    """
    Get relationship stats between two avatars.
    
    Returns sentiment, familiarity, and interaction_count.
    - sentiment: 0.5 = neutral, <0.5 = dislike, >0.5 = like
    - familiarity: 0 = strangers, 1 = very familiar
    - interaction_count: number of conversations
    """
    client = agent_db.get_supabase_client()
    if not client:
        return {
            "ok": True,
            "sentiment": 0.5,
            "familiarity": 0.0,
            "interaction_count": 0,
            "is_new": True
        }
    
    social_memory = agent_db.get_social_memory(client, from_id, to_id)
    
    if not social_memory:
        return {
            "ok": True,
            "sentiment": 0.5,  # Neutral default
            "familiarity": 0.0,
            "interaction_count": 0,
            "is_new": True,
            "last_interaction": None
        }
    
    # Convert last_interaction to ISO string if it exists
    last_interaction_str = None
    if social_memory.last_interaction:
        if hasattr(social_memory.last_interaction, 'isoformat'):
            last_interaction_str = social_memory.last_interaction.isoformat()
        else:
            last_interaction_str = str(social_memory.last_interaction)
    
    return {
        "ok": True,
        "sentiment": social_memory.sentiment,
        "familiarity": social_memory.familiarity,
        "interaction_count": social_memory.interaction_count,
        "last_topic": social_memory.last_conversation_topic,
        "is_new": False,
        "last_interaction": last_interaction_str
    }


# ============================================================================
# AGENT MONITORING ENDPOINTS
# ============================================================================

class CompleteActivityRequest(BaseModel):
    location_type: Optional[str] = None
    location_id: Optional[str] = None
    effects: Optional[dict] = None
    progress: float = 1.0  # 0.0 to 1.0 - how much of the activity was completed
    completed_full: bool = True  # Whether the activity was completed fully

@app.post("/agent/{avatar_id}/complete-activity")
def complete_activity(avatar_id: str, request: CompleteActivityRequest):
    """
    Complete a location activity and update agent stats.
    
    Stats are updated proportionally based on progress (0.0 to 1.0).
    If completed_full is True, stats are fully restored. Otherwise, partial benefit.
    
    Based on the location type, the relevant stat is boosted:
    - food: hunger -> 0 (fully fed)
    - rest_area: energy -> 1 (fully rested)
    - social_hub: loneliness -> 0 (fully social)
    - karaoke: mood -> 1 (max happy)
    - wander_point: applies effects or small mood boost
    """
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    location_type = request.location_type
    effects = request.effects
    progress = max(0.0, min(1.0, request.progress))  # Clamp to 0-1
    completed_full = request.completed_full
    
    try:
        state = agent_db.get_state(client, avatar_id)
        if not state:
            # Initialize if doesn't exist
            personality, state = agent_db.initialize_agent(client, avatar_id)
        
        # Apply effects based on location type
        # If completed_full, set to max/min. Otherwise, apply proportional benefit.
        if location_type == 'food':
            if completed_full:
                state.hunger = 0.0  # Fully fed
            else:
                # Reduce hunger proportionally (e.g., 50% progress = reduce hunger by 50% of current)
                state.hunger = max(0.0, state.hunger * (1 - progress))
            state.mood = min(1.0, state.mood + 0.1 * progress)
        elif location_type == 'rest_area':
            if completed_full:
                state.energy = 1.0  # Fully rested
            else:
                # Increase energy proportionally
                state.energy = min(1.0, state.energy + (1.0 - state.energy) * progress)
            state.mood = min(1.0, state.mood + 0.1 * progress)
        elif location_type == 'social_hub':
            if completed_full:
                state.loneliness = 0.0  # Fully social
            else:
                # Reduce loneliness proportionally
                state.loneliness = max(0.0, state.loneliness * (1 - progress))
            state.mood = min(1.0, state.mood + 0.1 * progress)
        elif location_type == 'karaoke':
            if completed_full:
                state.mood = 1.0  # Max happy
            else:
                # Increase mood proportionally
                state.mood = min(1.0, state.mood + (1.0 - state.mood) * progress)
            state.loneliness = max(0.0, state.loneliness - 0.3 * progress)
        elif location_type == 'wander_point':
            state.mood = min(1.0, state.mood + 0.1 * progress)
            state.energy = max(0.0, state.energy - 0.05 * progress)
        
        # If custom effects are provided, apply them proportionally
        if effects:
            for stat_name, delta in effects.items():
                adjusted_delta = delta * progress
                if stat_name == 'hunger':
                    state.hunger = max(0.0, min(1.0, state.hunger + adjusted_delta))
                elif stat_name == 'energy':
                    state.energy = max(0.0, min(1.0, state.energy + adjusted_delta))
                elif stat_name == 'loneliness':
                    state.loneliness = max(0.0, min(1.0, state.loneliness + adjusted_delta))
                elif stat_name == 'mood':
                    state.mood = max(-1.0, min(1.0, state.mood + adjusted_delta))
        
        # Save updated state
        agent_db.update_state(client, state)
        
        print(f"[Activity] {avatar_id[:8]} completed {location_type} ({progress*100:.0f}% progress)")
        print(f"[Activity] New stats: E:{state.energy:.0%} H:{state.hunger:.0%} L:{state.loneliness:.0%} M:{state.mood:.0%}")
        
        # Also update current_action to 'idle' to show they're done
        state.current_action = 'idle'
        state.current_action_target = None
        agent_db.update_state(client, state)
        
        return {
            "ok": True,
            "updated_stats": {
                "energy": state.energy,
                "hunger": state.hunger,
                "loneliness": state.loneliness,
                "mood": state.mood
            },
            "progress": progress,
            "completed_full": completed_full
        }
        
    except Exception as e:
        print(f"Error completing activity: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class StartActivityRequest(BaseModel):
    location_type: str
    location_id: str
    location_name: Optional[str] = None

@app.post("/agent/{avatar_id}/start-activity")
def start_activity(avatar_id: str, request: StartActivityRequest):
    """
    Mark an agent as starting a location activity.
    Updates the agent's current_action for visibility in the UI.
    """
    client = agent_db.get_supabase_client()
    if not client:
        raise HTTPException(status_code=503, detail="Database unavailable")
    
    try:
        state = agent_db.get_state(client, avatar_id)
        if not state:
            personality, state = agent_db.initialize_agent(client, avatar_id)
        
        # Map location type to action
        action_map = {
            'food': 'interact_food',
            'rest_area': 'interact_rest',
            'social_hub': 'interact_social_hub',
            'karaoke': 'interact_karaoke',
            'wander_point': 'interact_wander_point'
        }
        
        action = action_map.get(request.location_type, 'idle')
        state.current_action = action
        state.current_action_target = {
            'target_type': 'location',
            'target_id': request.location_id,
            'name': request.location_name or request.location_type
        }
        
        agent_db.update_state(client, state)
        
        print(f"[Activity] {avatar_id[:8]} started {action} at {request.location_name or request.location_type}")
        
        return {"ok": True, "action": action}
        
    except Exception as e:
        print(f"Error starting activity: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
            
                        # Prefer current_action from agent_state (for players doing activities)
            # Fall back to agent_decisions (for AI-controlled agents)
            current_action = state.get("current_action") or decision.get("selected_action", "idle")
            
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
                "current_action": current_action,
                "current_action_target": state.get("current_action_target"),
                "last_action_time": decision.get("tick_timestamp"),
            })
        
        return {"ok": True, "data": agents}
        
    except Exception as e:
        print(f"Error fetching all agents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# USER RELATIONSHIPS AND CONVERSATION HISTORY
# ============================================================================

@app.get("/user/{user_id}/relationships")
def get_user_relationships(user_id: str):
    """
    Get all relationships for a user.
    
    Returns a list of people they've interacted with, including:
    - Sentiment (how they feel about each person)
    - Familiarity (how well they know them)
    - Interaction count (number of conversations)
    - Last interaction time
    - Relationship notes
    """
    try:
        client = agent_db.get_supabase_client()
        if not client:
            raise HTTPException(status_code=500, detail="Database unavailable")
        
        # Get all social memories FROM this user (how they feel about others)
        response = client.table("agent_social_memory").select(
            "to_avatar_id, sentiment, familiarity, interaction_count, last_interaction, last_conversation_topic, mutual_interests, conversation_history_summary, relationship_notes"
        ).eq("from_avatar_id", user_id).order("last_interaction", desc=True).execute()
        
        relationships = []
        for row in response.data or []:
            # Get the other person's display name
            partner_id = row["to_avatar_id"]
            partner_info = client.table("user_positions").select("display_name, sprite_front").eq("user_id", partner_id).execute()
            partner_name = "Unknown"
            partner_sprite = None
            if partner_info.data and len(partner_info.data) > 0:
                partner_name = partner_info.data[0].get("display_name", "Unknown")
                partner_sprite = partner_info.data[0].get("sprite_front")
            
            # Parse mutual interests if it's a string
            mutual_interests = row.get("mutual_interests", [])
            if isinstance(mutual_interests, str):
                try:
                    mutual_interests = json.loads(mutual_interests)
                except Exception:
                    mutual_interests = []
            
            relationships.append({
                "partner_id": partner_id,
                "partner_name": partner_name,
                "partner_sprite": partner_sprite,
                "sentiment": row.get("sentiment", 0.5),
                "familiarity": row.get("familiarity", 0),
                "interaction_count": row.get("interaction_count", 0),
                "last_interaction": row.get("last_interaction"),
                "last_topic": row.get("last_conversation_topic"),
                "mutual_interests": mutual_interests,
                "conversation_summary": row.get("conversation_history_summary"),
                "relationship_notes": row.get("relationship_notes")
            })
        
        return {"ok": True, "data": relationships}
        
    except Exception as e:
        print(f"Error fetching relationships: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/user/{user_id}/conversations")
def get_user_conversations(user_id: str):
    """
    Get all conversations for a user.
    
    Returns a list of conversations with:
    - Partner info
    - Transcript
    - Timestamps
    - Memory/summary of the conversation
    """
    try:
        client = agent_db.get_supabase_client()
        if not client:
            raise HTTPException(status_code=500, detail="Database unavailable")
        
        # Get conversations where user is a participant
        convs_a = client.table("conversations").select(
            "id, participant_a, participant_b, transcript, created_at, ended_at"
        ).eq("participant_a", user_id).eq("is_onboarding", False).order("created_at", desc=True).limit(50).execute()
        
        convs_b = client.table("conversations").select(
            "id, participant_a, participant_b, transcript, created_at, ended_at"
        ).eq("participant_b", user_id).eq("is_onboarding", False).order("created_at", desc=True).limit(50).execute()
        
        # Combine and deduplicate
        all_convs = []
        seen_ids = set()
        
        for conv in (convs_a.data or []) + (convs_b.data or []):
            if conv["id"] in seen_ids:
                continue
            seen_ids.add(conv["id"])
            
            # Determine partner
            partner_id = conv["participant_b"] if conv["participant_a"] == user_id else conv["participant_a"]
            
            # Get partner info
            partner_info = client.table("user_positions").select("display_name, sprite_front").eq("user_id", partner_id).execute()
            partner_name = "Unknown"
            partner_sprite = None
            if partner_info.data and len(partner_info.data) > 0:
                partner_name = partner_info.data[0].get("display_name", "Unknown")
                partner_sprite = partner_info.data[0].get("sprite_front")
            
            # Get memory for this conversation
            memory = client.table("memories").select("summary, conversation_score").eq("conversation_id", conv["id"]).eq("owner_id", user_id).execute()
            summary = None
            score = None
            if memory.data and len(memory.data) > 0:
                summary = memory.data[0].get("summary")
                score = memory.data[0].get("conversation_score")
            
            transcript = conv.get("transcript", [])
            message_count = len(transcript) if isinstance(transcript, list) else 0
            
            all_convs.append({
                "id": conv["id"],
                "partner_id": partner_id,
                "partner_name": partner_name,
                "partner_sprite": partner_sprite,
                "created_at": conv.get("created_at"),
                "ended_at": conv.get("ended_at"),
                "message_count": message_count,
                "summary": summary,
                "score": score,
                "transcript": transcript  # Full transcript for display
            })
        
        # Sort by created_at descending
        all_convs.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        
        return {"ok": True, "data": all_convs[:50]}
        
    except Exception as e:
        print(f"Error fetching conversations: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# AGENT ACTIVITY SUMMARY ENDPOINT
# ============================================================================

@app.get("/agent/{avatar_id}/activity-summary")
async def get_agent_activity_summary(avatar_id: str):
    """
    Get a summary of what the agent did while the user was offline.
    Returns recent conversations, movements, and activities.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    
    try:
        summary_parts = []
        
        # Get agent's current action
        state_result = supabase.table("agent_state").select(
            "current_action, current_action_target, action_started_at"
        ).eq("avatar_id", avatar_id).execute()
        
        if state_result.data and len(state_result.data) > 0:
            state = state_result.data[0]
            current_action = state.get("current_action", "idle")
            
            # Translate action to readable text
            action_descriptions = {
                "idle": "standing around",
                "wander": "walking around exploring",
                "walk_to_location": "heading somewhere",
                "interact_food": "grabbing some food",
                "interact_rest": "taking a rest",
                "interact_karaoke": "singing karaoke",
                "interact_social_hub": "hanging out at the social hub",
                "interact_wander_point": "exploring the area",
                "initiate_conversation": "chatting with someone",
                "join_conversation": "in a conversation",
            }
            
            if current_action and current_action != "idle":
                desc = action_descriptions.get(current_action, current_action.replace("_", " "))
                summary_parts.append(f"was {desc}")
        
        # Get recent conversations (last 24 hours)
        from datetime import datetime, timedelta
        since = (datetime.utcnow() - timedelta(hours=24)).isoformat()
        
        conv_result = supabase.table("conversations").select(
            "id, participant_a, participant_b, created_at, ended_at, summary"
        ).or_(f"participant_a.eq.{avatar_id},participant_b.eq.{avatar_id}").gte(
            "created_at", since
        ).order("created_at", desc=True).limit(5).execute()
        
        if conv_result.data and len(conv_result.data) > 0:
            # Get partner names
            partner_ids = set()
            for conv in conv_result.data:
                partner_id = conv["participant_b"] if conv["participant_a"] == avatar_id else conv["participant_a"]
                partner_ids.add(partner_id)
            
            # Fetch partner names
            partner_names = {}
            if partner_ids:
                names_result = supabase.table("user_positions").select(
                    "user_id, display_name"
                ).in_("user_id", list(partner_ids)).execute()
                
                if names_result.data:
                    for row in names_result.data:
                        partner_names[row["user_id"]] = row.get("display_name", "someone")
            
            # Build conversation summary
            conv_count = len(conv_result.data)
            if conv_count == 1:
                partner_id = conv_result.data[0]["participant_b"] if conv_result.data[0]["participant_a"] == avatar_id else conv_result.data[0]["participant_a"]
                partner_name = partner_names.get(partner_id, "someone")
                summary_parts.append(f"had a conversation with {partner_name}")
            else:
                # List unique partners
                unique_partners = []
                for conv in conv_result.data:
                    partner_id = conv["participant_b"] if conv["participant_a"] == avatar_id else conv["participant_a"]
                    name = partner_names.get(partner_id, "someone")
                    if name not in unique_partners:
                        unique_partners.append(name)
                
                if len(unique_partners) <= 3:
                    summary_parts.append(f"chatted with {', '.join(unique_partners)}")
                else:
                    summary_parts.append(f"had {conv_count} conversations with various people")
        
        # Get user's position to describe location
        pos_result = supabase.table("user_positions").select("x, y").eq("user_id", avatar_id).execute()
        
        if pos_result.data and len(pos_result.data) > 0:
            pos = pos_result.data[0]
            x = pos.get("x", 30)
            
            # Describe general area
            if x < 20:
                area = "the west side"
            elif x > 40:
                area = "the east side"
            else:
                area = "the center area"
            
            summary_parts.append(f"ended up in {area}")
        
        # Build final summary
        if summary_parts:
            summary = "While you were away, your character " + ", ".join(summary_parts) + "."
        else:
            summary = "Your character was just hanging around while you were away."
        
        return {
            "ok": True,
            "summary": summary,
            "conversation_count": len(conv_result.data) if conv_result.data else 0
        }
        
    except Exception as e:
        print(f"Error getting activity summary: {e}")
        # Return a default summary on error
        return {
            "ok": True,
            "summary": "Welcome back! Your character explored while you were away.",
            "conversation_count": 0
        }


# ============================================================================
# RESPAWN ENDPOINT
# ============================================================================

@app.post("/player/{user_id}/respawn")
async def respawn_player(user_id: str):
    """
    Respawn a player to the center of the map.
    This is called from the game UI when a player wants to respawn.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    
    try:
        # Map dimensions (matching realtime-server config)
        MAP_WIDTH = 60
        MAP_HEIGHT = 40
        
        # Spawn in the middle
        center_x = MAP_WIDTH // 2
        center_y = MAP_HEIGHT // 2
        
        # Update the user's position in the database
        result = supabase.table("user_positions").update({
            "x": center_x,
            "y": center_y,
            "facing_x": 0,
            "facing_y": 1  # Face down
        }).eq("user_id", user_id).execute()
        
        if not result.data:
            raise HTTPException(status_code=404, detail="User not found")
        
        return {
            "ok": True, 
            "x": center_x, 
            "y": center_y,
            "message": "Respawned to center of map"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error respawning player: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# NPC CREATION - Create LLM-controlled characters without authentication
# ============================================================================

class CreateNPCRequest(BaseModel):
    """Request to create a new NPC character"""
    display_name: str
    sprite_front: Optional[str] = None
    sprite_back: Optional[str] = None
    sprite_left: Optional[str] = None
    sprite_right: Optional[str] = None


class UpdateNPCRequest(BaseModel):
    """Request to update an existing NPC's sprites/name"""
    npc_id: str
    display_name: Optional[str] = None
    sprite_front: Optional[str] = None
    sprite_back: Optional[str] = None
    sprite_left: Optional[str] = None
    sprite_right: Optional[str] = None


class CreateNPCResponse(BaseModel):
    """Response from creating an NPC"""
    ok: bool
    npc_id: Optional[str] = None
    display_name: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None


@app.post("/create-npc", response_model=CreateNPCResponse)
async def create_npc(req: CreateNPCRequest):
    """
    Create a new NPC character that will be controlled by LLMs.
    This endpoint does NOT require authentication - NPCs are public characters.
    
    The NPC will:
    - Get a random UUID (not tied to auth.users)
    - Be inserted into user_positions with is_npc=true
    - Have agent_state and agent_personality initialized
    - Be automatically controlled by the AI loop
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    
    if not req.display_name or not req.display_name.strip():
        raise HTTPException(status_code=400, detail="Display name is required")
    
    try:
        # Generate a random UUID for the NPC
        npc_id = str(uuid.uuid4())
        
        # Map dimensions (matching realtime-server config)
        MAP_WIDTH = 60
        MAP_HEIGHT = 40
        
        # Spawn at a random position (not in the center to avoid crowding)
        spawn_x = random.randint(10, MAP_WIDTH - 10)
        spawn_y = random.randint(10, MAP_HEIGHT - 10)
        
        print(f"[NPC] Creating NPC '{req.display_name}' with ID {npc_id} at ({spawn_x}, {spawn_y})")
        
        # Insert into user_positions with is_npc=true
        position_result = supabase.table("user_positions").insert({
            "user_id": npc_id,
            "x": spawn_x,
            "y": spawn_y,
            "facing_x": 0,
            "facing_y": 1,
            "display_name": req.display_name.strip(),
            "has_avatar": True,
            "sprite_front": req.sprite_front,
            "sprite_back": req.sprite_back,
            "sprite_left": req.sprite_left,
            "sprite_right": req.sprite_right,
            "is_npc": True,  # Mark as NPC
            "conversation_state": "IDLE"
        }).execute()
        
        if not position_result.data:
            raise Exception("Failed to create NPC position")
        
        print(f"[NPC] Position created for {req.display_name}")
        
        # Initialize agent personality with random values (for variety)
        # Note: agent_personality table has: sociability, curiosity, agreeableness, energy_baseline, world_affinities
        supabase.table("agent_personality").insert({
            "avatar_id": npc_id,
            "sociability": random.uniform(0.6, 1.0),  # NPCs are social!
            "curiosity": random.uniform(0.4, 0.9),
            "agreeableness": random.uniform(0.5, 0.9),
            "energy_baseline": random.uniform(0.7, 1.0),  # High energy
            "world_affinities": {"food": 0.3, "karaoke": 0.5, "rest_area": 0.1, "social_hub": 0.9, "wander_point": 0.7}
        }).execute()
        
        print(f"[NPC] Personality created for {req.display_name}")
        
        # Initialize agent state with optimal values for social behavior
        supabase.table("agent_state").insert({
            "avatar_id": npc_id,
            "energy": 1.0,  # Always full energy
            "hunger": 0.0,  # Never hungry
            "loneliness": 0.5,  # Somewhat lonely to encourage chatting
            "mood": 0.5,  # Positive mood
            "current_action": None,
            "current_action_target": None
        }).execute()
        
        print(f"[NPC] State created for {req.display_name}")
        
        return CreateNPCResponse(
            ok=True,
            npc_id=npc_id,
            display_name=req.display_name.strip(),
            message=f"NPC '{req.display_name}' created successfully! They will appear in the game world."
        )
        
    except Exception as e:
        print(f"[NPC] Error creating NPC: {e}")
        return CreateNPCResponse(
            ok=False,
            error=str(e)
        )


@app.post("/update-npc")
async def update_npc(req: UpdateNPCRequest):
    """
    Update an existing NPC's sprites and/or display name.
    This is called when the avatar is generated after the NPC was initially created.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    
    if not req.npc_id:
        raise HTTPException(status_code=400, detail="npc_id is required")
    
    try:
        # Build update data - only include fields that are provided
        update_data = {}
        
        if req.display_name:
            update_data["display_name"] = req.display_name.strip()
        
        if req.sprite_front:
            update_data["sprite_front"] = req.sprite_front
        
        if req.sprite_back:
            update_data["sprite_back"] = req.sprite_back
        
        if req.sprite_left:
            update_data["sprite_left"] = req.sprite_left
        
        if req.sprite_right:
            update_data["sprite_right"] = req.sprite_right
        
        # Mark has_avatar as true if we have any sprites
        if req.sprite_front or req.sprite_back or req.sprite_left or req.sprite_right:
            update_data["has_avatar"] = True
        
        if not update_data:
            return {"ok": True, "message": "No updates provided"}
        
        print(f"[NPC] Updating NPC {req.npc_id} with: {list(update_data.keys())}")
        
        # Update in database
        result = supabase.table("user_positions").update(update_data).eq("user_id", req.npc_id).execute()
        
        if not result.data:
            return {"ok": False, "error": "NPC not found"}
        
        print(f"[NPC] Successfully updated NPC {req.npc_id}")
        
        return {"ok": True, "message": "NPC updated successfully"}
        
    except Exception as e:
        print(f"[NPC] Error updating NPC: {e}")
        return {"ok": False, "error": str(e)}


@app.post("/create-npc-chat")
async def create_npc_chat(req: dict):
    """
    Chat endpoint for NPC creation onboarding.
    Similar to regular onboarding but without authentication.
    The NPC ID should be provided to associate the conversation.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    
    npc_id = req.get("npc_id")
    message = req.get("message", "")
    conversation_id = req.get("conversation_id")
    
    if not npc_id:
        raise HTTPException(status_code=400, detail="npc_id is required")
    
    # Reuse the onboarding chat logic but for NPC
    # This is a simplified version - just store the transcript
    try:
        transcript = []
        
        if conversation_id:
            # Get existing conversation
            res = supabase.table("conversations").select("*").eq("id", conversation_id).single().execute()
            if res.data:
                transcript = res.data.get("transcript", [])
        else:
            # Create new conversation for NPC
            new_conv = supabase.table("conversations").insert({
                "participant_a": npc_id,
                "is_onboarding": True,
                "transcript": []
            }).execute()
            conversation_id = new_conv.data[0]["id"]
        
        # Add user message to transcript
        if message and message != "[START]":
            transcript.append({"role": "user", "content": message})
        
        # Generate AI response (simplified for NPC creation)
        response_text = "Tell me about yourself! What's your personality like? What do you enjoy doing?"
        
        if len(transcript) > 0:
            # Use the onboarding system to generate a response
            from .onboarding import QUESTIONS
            from openai import OpenAI
            OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
            if OPENROUTER_API_KEY:
                try:
                    client = OpenAI(
                        base_url="https://openrouter.ai/api/v1",
                        api_key=OPENROUTER_API_KEY,
                    )
                    
                    system_instruction = f"""
                    You are a friendly, casual interviewer for a virtual world called 'Identity Matrix'. 
                    You're helping create a new NPC character. Get to know their personality.
                    
                    QUESTIONS TO ASK:
                    {json.dumps(QUESTIONS, indent=2)}
                    
                    INSTRUCTIONS:
                    1. Ask questions ONE BY ONE to learn about this character's personality.
                    2. Keep responses concise (1-2 sentences).
                    3. Be friendly and encouraging.
                    4. Use plain text only, no markdown.
                    """
                    
                    messages = [{"role": "system", "content": system_instruction}]
                    for msg in transcript:
                        messages.append(msg)
                    
                    completion = client.chat.completions.create(
                        model="x-ai/grok-4-fast",
                        messages=messages,
                        max_tokens=200
                    )
                    
                    response_text = completion.choices[0].message.content or response_text
                except Exception as e:
                    print(f"[NPC Chat] LLM error: {e}")
        
        # Add AI response to transcript
        transcript.append({"role": "assistant", "content": response_text})
        
        # Update conversation
        supabase.table("conversations").update({
            "transcript": transcript
        }).eq("id", conversation_id).execute()
        
        return {
            "ok": True,
            "response": response_text,
            "conversation_id": conversation_id
        }
        
    except Exception as e:
        print(f"[NPC Chat] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/complete-npc-onboarding")
async def complete_npc_onboarding(req: dict):
    """
    Complete the NPC onboarding and update their personality based on the conversation.
    """
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    
    npc_id = req.get("npc_id")
    conversation_id = req.get("conversation_id")
    
    if not npc_id:
        raise HTTPException(status_code=400, detail="npc_id is required")
    
    try:
        if conversation_id:
            # Get conversation transcript
            res = supabase.table("conversations").select("transcript").eq("id", conversation_id).single().execute()
            if res.data:
                transcript = res.data.get("transcript", [])
                
                # Use LLM to analyze personality from transcript
                from openai import OpenAI
                OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
                
                if OPENROUTER_API_KEY and len(transcript) > 2:
                    try:
                        client = OpenAI(
                            base_url="https://openrouter.ai/api/v1",
                            api_key=OPENROUTER_API_KEY,
                        )
                        
                        analysis_prompt = f"""
                        Analyze this conversation and extract personality traits on a scale of 0.0 to 1.0.
                        
                        Conversation:
                        {json.dumps(transcript, indent=2)}
                        
                        Return ONLY a JSON object with these traits:
                        {{
                            "sociability": 0.0-1.0,
                            "curiosity": 0.0-1.0,
                            "agreeableness": 0.0-1.0,
                            "energy_baseline": 0.0-1.0
                        }}
                        """
                        
                        completion = client.chat.completions.create(
                            model="x-ai/grok-4-fast",
                            messages=[{"role": "user", "content": analysis_prompt}],
                            max_tokens=200
                        )
                        
                        response_text = completion.choices[0].message.content or ""
                        
                        # Parse personality from response
                        json_match = re.search(r'\{[^}]+\}', response_text)
                        if json_match:
                            personality = json.loads(json_match.group())
                            
                            # Update NPC personality (columns: sociability, curiosity, agreeableness, energy_baseline)
                            supabase.table("agent_personality").update({
                                "sociability": min(1.0, max(0.0, personality.get("sociability", 0.7))),
                                "curiosity": min(1.0, max(0.0, personality.get("curiosity", 0.6))),
                                "agreeableness": min(1.0, max(0.0, personality.get("agreeableness", 0.7))),
                                "energy_baseline": min(1.0, max(0.0, personality.get("energy_baseline", 0.8)))
                            }).eq("avatar_id", npc_id).execute()
                            
                            print(f"[NPC] Updated personality for {npc_id}: {personality}")
                            
                    except Exception as e:
                        print(f"[NPC] Personality analysis error: {e}")
                
                # Mark conversation as completed
                supabase.table("conversations").update({
                    "completed_at": "now()"
                }).eq("id", conversation_id).execute()
        
        return {"ok": True, "message": "NPC onboarding completed!"}
        
    except Exception as e:
        print(f"[NPC] Complete error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3003)
