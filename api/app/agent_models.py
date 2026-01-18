"""
Pydantic models for the Agent Decision System
"""

from pydantic import BaseModel, Field, validator
from typing import Optional, Literal
from datetime import datetime
from enum import Enum


# ============================================================================
# ENUMS
# ============================================================================

class ActionType(str, Enum):
    # World actions
    IDLE = "idle"
    WANDER = "wander"
    WALK_TO_LOCATION = "walk_to_location"
    INTERACT_FOOD = "interact_food"
    INTERACT_KARAOKE = "interact_karaoke"
    INTERACT_REST = "interact_rest"
    INTERACT_SOCIAL_HUB = "interact_social_hub"
    INTERACT_WANDER_POINT = "interact_wander_point"
    # Social actions
    INITIATE_CONVERSATION = "initiate_conversation"
    JOIN_CONVERSATION = "join_conversation"
    LEAVE_CONVERSATION = "leave_conversation"
    AVOID_AVATAR = "avoid_avatar"  # Move away from disliked avatars
    # Movement
    MOVE = "move"
    STAND_STILL = "stand_still"


class LocationType(str, Enum):
    FOOD = "food"
    KARAOKE = "karaoke"
    REST_AREA = "rest_area"
    SOCIAL_HUB = "social_hub"
    WANDER_POINT = "wander_point"


# ============================================================================
# PERSONALITY MODEL
# ============================================================================

class AgentPersonality(BaseModel):
    """Static personality traits that bias decision scoring"""
    avatar_id: str
    sociability: float = Field(default=0.5, ge=0.0, le=1.0, description="Preference for social interactions")
    curiosity: float = Field(default=0.5, ge=0.0, le=1.0, description="Preference for exploration")
    agreeableness: float = Field(default=0.5, ge=0.0, le=1.0, description="Tendency to accept social requests")
    energy_baseline: float = Field(default=0.5, ge=0.0, le=1.0, description="Natural energy level")
    world_affinities: dict[str, float] = Field(
        default_factory=lambda: {
            "food": 0.5,
            "karaoke": 0.5,
            "rest_area": 0.5,
            "social_hub": 0.5,
            "wander_point": 0.5
        },
        description="Affinity scores for different location types"
    )
    # Detailed profile learned from conversations
    profile_summary: Optional[str] = Field(default=None, description="Detailed summary of who this person is")
    communication_style: Optional[str] = Field(default=None, description="How this person communicates")
    interests: Optional[list] = Field(default=None, description="Array of interests/hobbies")
    conversation_topics: Optional[list] = Field(default=None, description="Topics they like to discuss")
    personality_notes: Optional[str] = Field(default=None, description="Notes about observed personality traits")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    @validator('world_affinities', pre=True, always=True)
    def parse_world_affinities(cls, v):
        """Parse world_affinities if it's a JSON string from the database."""
        if v is None:
            return {"food": 0.5, "karaoke": 0.5, "rest_area": 0.5, "social_hub": 0.5, "wander_point": 0.5}
        if isinstance(v, str):
            import json
            try:
                return json.loads(v)
            except:
                return {"food": 0.5, "karaoke": 0.5, "rest_area": 0.5, "social_hub": 0.5, "wander_point": 0.5}
        return v
    
    @validator('interests', 'conversation_topics', pre=True, always=True)
    def parse_json_lists(cls, v):
        """Parse JSON string fields that should be lists."""
        if v is None:
            return None
        if isinstance(v, str):
            import json
            try:
                return json.loads(v)
            except:
                return None
        return v


# ============================================================================
# INTERNAL STATE (NEEDS)
# ============================================================================

class AgentState(BaseModel):
    """Dynamic internal state updated each tick"""
    avatar_id: str
    # Needs (0-1, except mood which is -1 to 1)
    energy: float = Field(default=0.8, ge=0.0, le=1.0)
    hunger: float = Field(default=0.3, ge=0.0, le=1.0)
    loneliness: float = Field(default=0.3, ge=0.0, le=1.0)
    mood: float = Field(default=0.5, ge=-1.0, le=1.0)
    # Current action (can be None if not set in DB)
    current_action: Optional[str] = "idle"
    current_action_target: Optional[dict] = None
    action_started_at: Optional[datetime] = None
    action_expires_at: Optional[datetime] = None
    # Tick tracking
    last_tick: Optional[datetime] = None
    tick_lock_until: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    def needs_food(self) -> bool:
        """Check if hunger is critical"""
        return self.hunger > 0.7

    def needs_rest(self) -> bool:
        """Check if energy is critically low"""
        return self.energy < 0.2

    def needs_socialization(self) -> bool:
        """Check if loneliness is high enough to seek conversation"""
        return self.loneliness > 0.3  # Reduced from 0.6 - agents are more social!


# ============================================================================
# SOCIAL MEMORY
# ============================================================================

class SocialMemory(BaseModel):
    """Directional relationship memory from one avatar to another"""
    id: Optional[str] = None
    from_avatar_id: str
    to_avatar_id: str
    sentiment: float = Field(default=0.0, ge=-1.0, le=1.0, description="How this avatar feels about the other")
    familiarity: float = Field(default=0.0, ge=0.0, le=1.0, description="How well they know the other")
    interaction_count: int = Field(default=0, ge=0)
    last_interaction: Optional[datetime] = None
    last_conversation_topic: Optional[str] = None
    # Enhanced relationship data
    mutual_interests: Optional[list] = Field(default=None, description="Shared interests between the two people")
    conversation_history_summary: Optional[str] = Field(default=None, description="Summary of all past conversations")
    relationship_notes: Optional[str] = Field(default=None, description="Notes about the relationship dynamic")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ============================================================================
# WORLD LOCATIONS
# ============================================================================

class WorldLocation(BaseModel):
    """Fixed location in the world with interaction effects"""
    id: str
    name: str
    location_type: LocationType
    x: int
    y: int
    description: Optional[str] = None
    effects: dict[str, float] = Field(default_factory=dict)
    cooldown_seconds: int = 300
    duration_seconds: int = 30
    created_at: Optional[datetime] = None


# ============================================================================
# WORLD INTERACTIONS
# ============================================================================

class WorldInteraction(BaseModel):
    """Record of an avatar interacting with a world location"""
    id: Optional[str] = None
    avatar_id: str
    location_id: str
    interaction_type: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    cooldown_until: Optional[datetime] = None
    created_at: Optional[datetime] = None


# ============================================================================
# ACTIONS
# ============================================================================

class ActionTarget(BaseModel):
    """Target for an action"""
    target_type: Literal["location", "avatar", "position"]
    target_id: Optional[str] = None
    name: Optional[str] = None  # Location name for logging
    x: Optional[int] = None
    y: Optional[int] = None


class CandidateAction(BaseModel):
    """A candidate action with its utility score"""
    action_type: ActionType
    target: Optional[ActionTarget] = None
    utility_score: float = 0.0
    # Score components for debugging
    need_satisfaction: float = 0.0
    personality_alignment: float = 0.0
    social_memory_bias: float = 0.0
    world_affinity: float = 0.0
    recency_penalty: float = 0.0
    randomness: float = 0.0


class SelectedAction(BaseModel):
    """The selected action to execute"""
    action_type: ActionType
    target: Optional[ActionTarget] = None
    utility_score: float = 0.0
    duration_seconds: Optional[float] = None


# ============================================================================
# AGENT CONTEXT - All data needed for decision making
# ============================================================================

class NearbyAvatar(BaseModel):
    """Information about a nearby avatar"""
    avatar_id: str
    display_name: Optional[str] = None
    x: int
    y: int
    distance: float
    is_online: bool
    # Populated from social memory
    sentiment: Optional[float] = None
    familiarity: Optional[float] = None
    last_interaction: Optional[datetime] = None


class AgentContext(BaseModel):
    """Complete context for agent decision making"""
    avatar_id: str
    # Position
    x: int
    y: int
    # Data
    personality: AgentPersonality
    state: AgentState
    social_memories: list[SocialMemory] = Field(default_factory=list)
    # World context
    nearby_avatars: list[NearbyAvatar] = Field(default_factory=list)
    world_locations: list[WorldLocation] = Field(default_factory=list)
    active_cooldowns: list[str] = Field(default_factory=list)  # Location IDs on cooldown
    # Conversation state
    in_conversation: bool = False
    pending_conversation_requests: list[dict] = Field(default_factory=list)


# ============================================================================
# AGENT DECISION LOG
# ============================================================================

class AgentDecisionLog(BaseModel):
    """Log entry for an agent decision (for debugging/audit)"""
    avatar_id: str
    tick_timestamp: datetime
    state_snapshot: dict
    available_actions: list[dict]
    selected_action: dict
    action_result: Optional[str] = None
    created_at: Optional[datetime] = None


# ============================================================================
# API MODELS
# ============================================================================

class AgentActionResponse(BaseModel):
    """Response from requesting an agent's next action"""
    ok: bool
    avatar_id: str
    action: Optional[str] = None
    target: Optional[dict] = None
    score: Optional[float] = None
    state: Optional[dict] = None
    error: Optional[str] = None


class InitializeAgentRequest(BaseModel):
    """Request to initialize agent data for an avatar"""
    avatar_id: str
    personality: Optional[AgentPersonality] = None


class InitializeAgentResponse(BaseModel):
    """Response from initializing an agent"""
    ok: bool
    avatar_id: str
    personality: Optional[AgentPersonality] = None
    state: Optional[AgentState] = None
    error: Optional[str] = None


class AgentStateUpdateRequest(BaseModel):
    """Request to manually update agent state"""
    avatar_id: str
    energy: Optional[float] = None
    hunger: Optional[float] = None
    loneliness: Optional[float] = None
    mood: Optional[float] = None


class SentimentUpdateRequest(BaseModel):
    """Request to update sentiment after a conversation"""
    from_avatar_id: str
    to_avatar_id: str
    sentiment_delta: float = Field(ge=-0.5, le=0.5)
    familiarity_delta: float = Field(default=0.1, ge=0.0, le=0.3)
    conversation_topic: Optional[str] = None
