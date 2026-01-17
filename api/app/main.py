"""
FastAPI server for Avatar creation and management
"""

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import shutil
import uuid
from contextlib import asynccontextmanager

from .models import AvatarCreate, AvatarUpdate, ApiResponse, AgentRequest, AgentResponse
from . import database as db
import random

# Ensure upload directories exist before mounting StaticFiles
Path("./uploads/sprites").mkdir(parents=True, exist_ok=True)

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

# Serve uploaded files
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


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
    Currently implements a simple random walk target selector.
    """
    # Simple logic: pick a random point on the map
    # In a real scenario, this would involve LLM or RL inference
    target_x = random.randint(0, req.map_width - 1)
    target_y = random.randint(0, req.map_height - 1)
    
    return {
        "target_x": target_x,
        "target_y": target_y,
        "action": "MOVE"
    }


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
    """Upload sprite image for avatar"""
    avatar = db.get_avatar_by_id(avatar_id)
    if not avatar:
        raise HTTPException(status_code=404, detail="Avatar not found")
    
    # Validate file type
    allowed_types = ["image/png", "image/jpeg", "image/gif", "image/webp"]
    if sprite.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Invalid file type")
    
    # Save file
    ext = Path(sprite.filename).suffix if sprite.filename else ".png"
    filename = f"sprite-{uuid.uuid4()}{ext}"
    file_path = Path(f"./uploads/sprites/{filename}")
    
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(sprite.file, buffer)
    
    # Delete old sprite if exists
    if avatar.get("sprite_path"):
        old_path = Path(avatar["sprite_path"])
        if old_path.exists():
            old_path.unlink()
    
    # Update database
    updated = db.update_avatar_sprite(avatar_id, str(file_path))
    return {"ok": True, "data": updated}


@app.delete("/avatars/{avatar_id}", response_model=ApiResponse)
def delete_avatar(avatar_id: str):
    """Delete avatar"""
    avatar = db.get_avatar_by_id(avatar_id)
    if not avatar:
        raise HTTPException(status_code=404, detail="Avatar not found")
    
    # Delete sprite file
    if avatar.get("sprite_path"):
        sprite_path = Path(avatar["sprite_path"])
        if sprite_path.exists():
            sprite_path.unlink()
    
    db.delete_avatar(avatar_id)
    return {"ok": True, "message": "Avatar deleted"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3003)
