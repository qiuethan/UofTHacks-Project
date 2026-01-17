"""
FastAPI server for Avatar creation and management
"""

import os
import sys
import shutil
import uuid
import random
import tempfile
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from supabase import create_client, Client

from .models import AvatarCreate, AvatarUpdate, ApiResponse, AgentRequest, AgentResponse, GenerateAvatarResponse
from . import database as db
from . import onboarding

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
    """
    
    # TODO: Implement AI decision logic
    
    try:
        # Handle pending conversation requests first
        if req.pending_requests:
            for pending in req.pending_requests:
                initiator_type = pending.get("initiator_type", "PLAYER")
                # Decide whether to accept or reject based on interest
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
        
        # If in conversation, stand still
        if req.conversation_state == "IN_CONVERSATION":
            response = {"action": "STAND_STILL", "duration": random.uniform(2.0, 5.0)}
            print(f"AI Decision for {req.robot_id}: {response}")
            return response
        
        # If walking to conversation partner, continue (handled by pathfinding)
        if req.conversation_state == "WALKING_TO_CONVERSATION":
            response = {"action": "STAND_STILL", "duration": 1.0}  # Check again soon
            print(f"AI Decision for {req.robot_id}: {response}")
            return response
        
        # Check if we should initiate a conversation with nearby entities
        if req.nearby_entities:
            for entity in req.nearby_entities:
                if entity.get("kind") in ["PLAYER", "ROBOT"] and entity.get("entityId") != req.robot_id:
                    interest = calculate_ai_interest_to_initiate(req.robot_id, entity.get("entityId", ""), entity.get("kind", "ROBOT"))
                    if should_ai_initiate(interest):
                        response = {
                            "action": "REQUEST_CONVERSATION",
                            "target_entity_id": entity.get("entityId")
                        }
                        print(f"AI Decision for {req.robot_id}: {response}")
                        return response
        
        # Default: random walk behavior
        # Small chance to stand still
        if random.random() < 0.1:
            response = {"action": "STAND_STILL", "duration": random.uniform(2.0, 8.0)}
            print(f"AI Decision for {req.robot_id}: {response}")
            return response
        
        # Define safe zone boundaries (avoid edges for 2x2 entities)
        MARGIN = 2
        min_x = MARGIN
        max_x = max(min_x + 1, req.map_width - MARGIN - 2)
        min_y = MARGIN
        max_y = max(min_y + 1, req.map_height - MARGIN - 2)
        
        # Collect obstacle positions from nearby entities (including walls)
        obstacles = set()
        if req.nearby_entities:
            for entity in req.nearby_entities:
                # Add all 4 cells of the 2x2 entity
                ex, ey = entity.get("x", -1), entity.get("y", -1)
                for dx in range(2):
                    for dy in range(2):
                        obstacles.add((ex + dx, ey + dy))
        
        # Avoid picking a target that is blocked
        target_x, target_y = random.randint(min_x, max_x), random.randint(min_y, max_y)
        
        max_attempts = 100
        for _ in range(max_attempts):
            is_blocked = False
            # Check if any of the 4 cells of the 2x2 robot target would be blocked
            for dx in range(2):
                for dy in range(2):
                    if (target_x + dx, target_y + dy) in obstacles:
                        is_blocked = True
                        break
                if is_blocked:
                    break
            
            if not is_blocked:
                break
                
            target_x = random.randint(min_x, max_x)
            target_y = random.randint(min_y, max_y)
        
        response = {
            "action": "MOVE",
            "target_x": target_x,
            "target_y": target_y
        }
        print(f"AI Decision for {req.robot_id}: {response}")
        return response
    except Exception as e:
        print(f"Error in get_agent_decision: {e}")
        # Fallback to a safe stand still action
        return {"action": "STAND_STILL", "duration": 5.0}
    

# ============================================================================
# AI INTEREST CALCULATIONS
# ============================================================================

def calculate_ai_interest_to_initiate(robot_id: str, target_id: str, target_type: str) -> float:
    """
    Calculate AI interest score for initiating a conversation.
    Returns probability between 0 and 1.
    TODO: Replace with actual interest calculation based on personality, history, etc.
    """
    base = 0.3  # Lower base for initiation
    variance = 0.2
    return max(0, min(1, base + (random.random() - 0.5) * 2 * variance))


def calculate_ai_interest_to_accept(robot_id: str, initiator_id: str, initiator_type: str = "PLAYER") -> float:
    """
    Calculate AI interest in accepting a conversation request.
    """
    if initiator_type == "PLAYER":
        return 1.0  # Always accept humans
        
    base = 0.5  # Base for other robots
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3003)
