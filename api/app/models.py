"""
Pydantic models for Avatar API
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class AvatarBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")
    bio: Optional[str] = Field(default=None, max_length=500)


class AvatarCreate(AvatarBase):
    pass


class AvatarUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    bio: Optional[str] = Field(default=None, max_length=500)


class Avatar(AvatarBase):
    id: str
    sprite_path: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ApiResponse(BaseModel):
    ok: bool
    data: Optional[Avatar | list[Avatar]] = None
    error: Optional[str] = None
    message: Optional[str] = None


class AgentRequest(BaseModel):
    robot_id: str
    x: int
    y: int
    map_width: int
    map_height: int
    # Nearby entities for conversation decisions
    nearby_entities: Optional[list[dict]] = None
    # Current conversation state
    conversation_state: Optional[str] = None
    pending_requests: Optional[list[dict]] = None


class AgentResponse(BaseModel):
    action: str = "MOVE"  # MOVE, STAND_STILL, REQUEST_CONVERSATION, ACCEPT_CONVERSATION, REJECT_CONVERSATION
    target_x: Optional[int] = None
    target_y: Optional[int] = None
    target_entity_id: Optional[str] = None  # For REQUEST_CONVERSATION
    request_id: Optional[str] = None  # For ACCEPT/REJECT_CONVERSATION
    duration: Optional[float] = None  # Duration in seconds for actions like STAND_STILL


class GenerateAvatarResponse(BaseModel):
    """Response model for avatar generation endpoint"""
    ok: bool
    message: Optional[str] = None
    error: Optional[str] = None
    images: Optional[dict[str, str]] = None  # {front: url, back: url, left: url, right: url}


class OnboardingChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None


class OnboardingChatResponse(BaseModel):
    response: str
    conversation_id: str
    status: str = "active"  # "active" or "completed"


class OnboardingStateResponse(BaseModel):
    history: list[dict]
    conversation_id: Optional[str]
    is_completed: bool


class OnboardingCompleteRequest(BaseModel):
    conversation_id: str

