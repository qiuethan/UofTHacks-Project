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
