"""
FastAPI server for Avatar creation and management
"""

import os
import shutil
import uuid
import random
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from supabase import create_client, Client

from .models import AvatarCreate, AvatarUpdate, ApiResponse, AgentRequest, AgentResponse
from . import database as db

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
    
    # Handle pending conversation requests first
    if req.pending_requests:
        for pending in req.pending_requests:
            # Decide whether to accept or reject based on interest
            interest = calculate_ai_interest_to_accept(req.robot_id, pending.get("initiator_id", ""))
            if should_ai_accept(interest):
                return {
                    "action": "ACCEPT_CONVERSATION",
                    "request_id": pending.get("request_id")
                }
            else:
                return {
                    "action": "REJECT_CONVERSATION",
                    "request_id": pending.get("request_id")
                }
    
    # If in conversation, stand still
    if req.conversation_state == "IN_CONVERSATION":
        return {"action": "STAND_STILL"}
    
    # If walking to conversation partner, continue (handled by pathfinding)
    if req.conversation_state == "WALKING_TO_CONVERSATION":
        return {"action": "STAND_STILL"}  # Let pathfinding handle it
    
    # Check if we should initiate a conversation with nearby entities
    if req.nearby_entities:
        for entity in req.nearby_entities:
            if entity.get("kind") in ["PLAYER", "ROBOT"] and entity.get("entityId") != req.robot_id:
                interest = calculate_ai_interest_to_initiate(req.robot_id, entity.get("entityId", ""), entity.get("kind", "ROBOT"))
                if should_ai_initiate(interest):
                    return {
                        "action": "REQUEST_CONVERSATION",
                        "target_entity_id": entity.get("entityId")
                    }
    
    # Default: random walk behavior
    # Small chance to stand still
    if random.random() < 0.1:
        return {"action": "STAND_STILL"}
    
    # Define safe zone boundaries (avoid edges for 2x2 entities)
    MARGIN = 3
    min_x = MARGIN
    max_x = max(min_x + 1, req.map_width - MARGIN - 2)
    min_y = MARGIN
    max_y = max(min_y + 1, req.map_height - MARGIN - 2)
    
    target_x = random.randint(min_x, max_x)
    target_y = random.randint(min_y, max_y)
    
    # Known wall positions
    walls = [
        (10, 10), (11, 10), (10, 11), (11, 11),
        (10, 12), (11, 12), (10, 13), (11, 13),
        (10, 14), (11, 14), (10, 15), (11, 15),
        (12, 10), (13, 10), (12, 11), (13, 11),
    ]
    
    # Avoid targets near walls
    max_attempts = 50
    for _ in range(max_attempts):
        is_near_wall = False
        for dx in range(-1, 3):
            for dy in range(-1, 3):
                if (target_x + dx, target_y + dy) in walls:
                    is_near_wall = True
                    break
            if is_near_wall:
                break
        if not is_near_wall:
            break
        target_x = random.randint(min_x, max_x)
        target_y = random.randint(min_y, max_y)
    
    return {
        "action": "MOVE",
        "target_x": target_x,
        "target_y": target_y
    }


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


def calculate_ai_interest_to_accept(robot_id: str, initiator_id: str) -> float:
    """
    Calculate AI interest in accepting a conversation request.
    TODO: Replace with actual interest calculation.
    """
    base = 0.7  # Higher acceptance rate
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3003)