"""
Database operations for the Agent Decision System using Supabase
"""

import os
import uuid
import random
from datetime import datetime, timedelta
from typing import Optional
from contextlib import contextmanager

from supabase import create_client, Client
from dotenv import load_dotenv

from .agent_models import (
    AgentPersonality,
    AgentState,
    SocialMemory,
    WorldLocation,
    WorldInteraction,
    AgentContext,
    NearbyAvatar,
    AgentDecisionLog,
    LocationType,
)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")


def get_supabase_client() -> Optional[Client]:
    """Get a Supabase client instance."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return None
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ============================================================================
# PERSONALITY OPERATIONS
# ============================================================================

def get_personality(client: Client, avatar_id: str) -> Optional[AgentPersonality]:
    """Get personality for an avatar."""
    result = client.table("agent_personality").select("*").eq("avatar_id", avatar_id).execute()
    if result.data and len(result.data) > 0:
        row = result.data[0]
        return AgentPersonality(
            avatar_id=row["avatar_id"],
            sociability=row["sociability"],
            curiosity=row["curiosity"],
            agreeableness=row["agreeableness"],
            energy_baseline=row["energy_baseline"],
            world_affinities=row.get("world_affinities", {}),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )
    return None


def create_personality(client: Client, personality: AgentPersonality) -> AgentPersonality:
    """Create personality for an avatar."""
    data = {
        "avatar_id": personality.avatar_id,
        "sociability": personality.sociability,
        "curiosity": personality.curiosity,
        "agreeableness": personality.agreeableness,
        "energy_baseline": personality.energy_baseline,
        "world_affinities": personality.world_affinities,
    }
    result = client.table("agent_personality").upsert(data).execute()
    return personality


def generate_random_personality(avatar_id: str) -> AgentPersonality:
    """Generate a random personality for a new avatar."""
    return AgentPersonality(
        avatar_id=avatar_id,
        sociability=0.3 + random.random() * 0.4,
        curiosity=0.3 + random.random() * 0.4,
        agreeableness=0.4 + random.random() * 0.3,
        energy_baseline=0.4 + random.random() * 0.3,
        world_affinities={
            "food": 0.3 + random.random() * 0.4,
            "karaoke": 0.2 + random.random() * 0.5,
            "rest_area": 0.3 + random.random() * 0.3,
            "social_hub": 0.3 + random.random() * 0.4,
            "wander_point": 0.3 + random.random() * 0.3,
        }
    )


# ============================================================================
# STATE OPERATIONS
# ============================================================================

def get_state(client: Client, avatar_id: str) -> Optional[AgentState]:
    """Get agent state for an avatar."""
    result = client.table("agent_state").select("*").eq("avatar_id", avatar_id).execute()
    if result.data and len(result.data) > 0:
        row = result.data[0]
        return AgentState(
            avatar_id=row["avatar_id"],
            energy=row["energy"],
            hunger=row["hunger"],
            loneliness=row["loneliness"],
            mood=row["mood"],
            current_action=row.get("current_action", "idle"),
            current_action_target=row.get("current_action_target"),
            action_started_at=row.get("action_started_at"),
            action_expires_at=row.get("action_expires_at"),
            last_tick=row.get("last_tick"),
            tick_lock_until=row.get("tick_lock_until"),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        )
    return None


def create_state(client: Client, state: AgentState) -> AgentState:
    """Create agent state for an avatar."""
    data = {
        "avatar_id": state.avatar_id,
        "energy": state.energy,
        "hunger": state.hunger,
        "loneliness": state.loneliness,
        "mood": state.mood,
        "current_action": state.current_action,
        "current_action_target": state.current_action_target,
    }
    result = client.table("agent_state").upsert(data).execute()
    return state


def update_state(client: Client, state: AgentState) -> AgentState:
    """Update agent state."""
    data = {
        "energy": state.energy,
        "hunger": state.hunger,
        "loneliness": state.loneliness,
        "mood": state.mood,
        "current_action": state.current_action,
        "current_action_target": state.current_action_target,
        "action_started_at": state.action_started_at.isoformat() if state.action_started_at else None,
        "action_expires_at": state.action_expires_at.isoformat() if state.action_expires_at else None,
        "updated_at": datetime.utcnow().isoformat(),
    }
    client.table("agent_state").update(data).eq("avatar_id", state.avatar_id).execute()
    return state


def generate_random_state(avatar_id: str) -> AgentState:
    """Generate random initial state for an avatar."""
    return AgentState(
        avatar_id=avatar_id,
        energy=0.7 + random.random() * 0.2,
        hunger=0.2 + random.random() * 0.2,
        loneliness=0.3 + random.random() * 0.2,
        mood=0.3 + random.random() * 0.4,
        current_action="idle",
    )


# ============================================================================
# SOCIAL MEMORY OPERATIONS
# ============================================================================

def get_social_memories(client: Client, from_avatar_id: str) -> list[SocialMemory]:
    """Get all social memories for an avatar (outgoing relationships)."""
    result = client.table("agent_social_memory").select("*").eq("from_avatar_id", from_avatar_id).execute()
    memories = []
    for row in result.data or []:
        memories.append(SocialMemory(
            id=row["id"],
            from_avatar_id=row["from_avatar_id"],
            to_avatar_id=row["to_avatar_id"],
            sentiment=row["sentiment"],
            familiarity=row["familiarity"],
            interaction_count=row.get("interaction_count", 0),
            last_interaction=row.get("last_interaction"),
            last_conversation_topic=row.get("last_conversation_topic"),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
        ))
    return memories


def get_social_memory(client: Client, from_avatar_id: str, to_avatar_id: str) -> Optional[SocialMemory]:
    """Get specific social memory between two avatars."""
    result = (
        client.table("agent_social_memory")
        .select("*")
        .eq("from_avatar_id", from_avatar_id)
        .eq("to_avatar_id", to_avatar_id)
        .execute()
    )
    if result.data and len(result.data) > 0:
        row = result.data[0]
        return SocialMemory(
            id=row["id"],
            from_avatar_id=row["from_avatar_id"],
            to_avatar_id=row["to_avatar_id"],
            sentiment=row["sentiment"],
            familiarity=row["familiarity"],
            interaction_count=row.get("interaction_count", 0),
            last_interaction=row.get("last_interaction"),
            last_conversation_topic=row.get("last_conversation_topic"),
        )
    return None


def update_social_memory(
    client: Client,
    from_avatar_id: str,
    to_avatar_id: str,
    sentiment_delta: float = 0.0,
    familiarity_delta: float = 0.0,
    conversation_topic: Optional[str] = None
) -> SocialMemory:
    """Update or create social memory between two avatars."""
    existing = get_social_memory(client, from_avatar_id, to_avatar_id)
    
    if existing:
        # Update existing
        new_sentiment = max(-1.0, min(1.0, existing.sentiment + sentiment_delta))
        new_familiarity = max(0.0, min(1.0, existing.familiarity + familiarity_delta))
        
        data = {
            "sentiment": new_sentiment,
            "familiarity": new_familiarity,
            "interaction_count": existing.interaction_count + 1,
            "last_interaction": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
        }
        if conversation_topic:
            data["last_conversation_topic"] = conversation_topic
        
        client.table("agent_social_memory").update(data).eq("id", existing.id).execute()
        
        return SocialMemory(
            id=existing.id,
            from_avatar_id=from_avatar_id,
            to_avatar_id=to_avatar_id,
            sentiment=new_sentiment,
            familiarity=new_familiarity,
            interaction_count=existing.interaction_count + 1,
            last_interaction=datetime.utcnow(),
            last_conversation_topic=conversation_topic or existing.last_conversation_topic,
        )
    else:
        # Create new
        new_id = str(uuid.uuid4())
        data = {
            "id": new_id,
            "from_avatar_id": from_avatar_id,
            "to_avatar_id": to_avatar_id,
            "sentiment": max(-1.0, min(1.0, sentiment_delta)),
            "familiarity": max(0.0, min(1.0, familiarity_delta)),
            "interaction_count": 1,
            "last_interaction": datetime.utcnow().isoformat(),
            "last_conversation_topic": conversation_topic,
        }
        client.table("agent_social_memory").insert(data).execute()
        
        return SocialMemory(
            id=new_id,
            from_avatar_id=from_avatar_id,
            to_avatar_id=to_avatar_id,
            sentiment=max(-1.0, min(1.0, sentiment_delta)),
            familiarity=max(0.0, min(1.0, familiarity_delta)),
            interaction_count=1,
            last_interaction=datetime.utcnow(),
            last_conversation_topic=conversation_topic,
        )


# ============================================================================
# WORLD LOCATION OPERATIONS
# ============================================================================

def get_all_world_locations(client: Client) -> list[WorldLocation]:
    """Get all world locations."""
    result = client.table("world_locations").select("*").execute()
    locations = []
    for row in result.data or []:
        locations.append(WorldLocation(
            id=row["id"],
            name=row["name"],
            location_type=LocationType(row["location_type"]),
            x=row["x"],
            y=row["y"],
            description=row.get("description"),
            effects=row.get("effects", {}),
            cooldown_seconds=row.get("cooldown_seconds", 300),
            duration_seconds=row.get("duration_seconds", 30),
            created_at=row.get("created_at"),
        ))
    return locations


# ============================================================================
# WORLD INTERACTION OPERATIONS
# ============================================================================

def get_active_cooldowns(client: Client, avatar_id: str) -> list[str]:
    """Get list of location IDs that are on cooldown for an avatar."""
    now = datetime.utcnow().isoformat()
    result = (
        client.table("world_interactions")
        .select("location_id")
        .eq("avatar_id", avatar_id)
        .gt("cooldown_until", now)
        .execute()
    )
    return [row["location_id"] for row in result.data or []]


def record_world_interaction(
    client: Client,
    avatar_id: str,
    location: WorldLocation
) -> WorldInteraction:
    """Record a world interaction and set cooldown."""
    now = datetime.utcnow()
    cooldown_until = now + timedelta(seconds=location.cooldown_seconds)
    
    interaction_id = str(uuid.uuid4())
    data = {
        "id": interaction_id,
        "avatar_id": avatar_id,
        "location_id": location.id,
        "interaction_type": location.location_type.value,
        "started_at": now.isoformat(),
        "cooldown_until": cooldown_until.isoformat(),
    }
    client.table("world_interactions").insert(data).execute()
    
    return WorldInteraction(
        id=interaction_id,
        avatar_id=avatar_id,
        location_id=location.id,
        interaction_type=location.location_type.value,
        started_at=now,
        cooldown_until=cooldown_until,
    )


def complete_world_interaction(client: Client, interaction_id: str) -> None:
    """Mark a world interaction as completed."""
    client.table("world_interactions").update({
        "completed_at": datetime.utcnow().isoformat()
    }).eq("id", interaction_id).execute()


# ============================================================================
# AVATAR/POSITION OPERATIONS
# ============================================================================

def get_nearby_avatars(client: Client, avatar_id: str, radius: int = 10) -> list[NearbyAvatar]:
    """Get avatars near a specific avatar."""
    result = client.rpc(
        "get_nearby_avatars",
        {"p_avatar_id": avatar_id, "p_radius": radius}
    ).execute()
    
    nearby = []
    for row in result.data or []:
        nearby.append(NearbyAvatar(
            avatar_id=row["avatar_id"],
            display_name=row.get("display_name"),
            x=row["x"],
            y=row["y"],
            distance=row["distance"],
            is_online=row.get("is_online", False),
        ))
    return nearby


def get_avatar_position(client: Client, avatar_id: str) -> Optional[dict]:
    """Get avatar position and conversation state (linked from user_positions)."""
    result = (
        client.table("user_positions")
        .select("x, y, display_name, is_online, conversation_state, conversation_partner_id, conversation_target_id")
        .eq("user_id", avatar_id)
        .execute()
    )
    if result.data and len(result.data) > 0:
        return result.data[0]
    return None


def update_avatar_position(client: Client, avatar_id: str, x: int, y: int) -> None:
    """Update avatar position."""
    client.table("user_positions").update({
        "x": x,
        "y": y,
        "updated_at": datetime.utcnow().isoformat()
    }).eq("user_id", avatar_id).execute()


# ============================================================================
# TICK LOCK OPERATIONS
# ============================================================================

def acquire_tick_lock(client: Client, avatar_id: str, lock_duration_seconds: int = 60) -> bool:
    """Acquire a tick lock for an avatar. Returns True if successful."""
    result = client.rpc(
        "acquire_agent_tick_lock",
        {"p_avatar_id": avatar_id, "p_lock_duration_seconds": lock_duration_seconds}
    ).execute()
    return result.data is True


def release_tick_lock(client: Client, avatar_id: str) -> None:
    """Release tick lock and update last_tick timestamp."""
    client.rpc("release_agent_tick_lock", {"p_avatar_id": avatar_id}).execute()


# ============================================================================
# DECISION LOG OPERATIONS
# ============================================================================

def log_decision(client: Client, log: AgentDecisionLog) -> None:
    """Log a decision for debugging/audit purposes."""
    data = {
        "avatar_id": log.avatar_id,
        "tick_timestamp": log.tick_timestamp.isoformat(),
        "state_snapshot": log.state_snapshot,
        "available_actions": log.available_actions,
        "selected_action": log.selected_action,
        "action_result": log.action_result,
    }
    client.table("agent_decisions").insert(data).execute()


# ============================================================================
# CONTEXT BUILDING (uses linked tables)
# ============================================================================

def build_agent_context(client: Client, avatar_id: str) -> Optional[AgentContext]:
    """
    Build the complete context needed for agent decision making.
    
    Links data from:
    - user_positions (position, conversation state)
    - agent_personality (traits)
    - agent_state (needs, current action)
    - agent_social_memory (relationships)
    - world_locations (POIs)
    - world_interactions (cooldowns)
    """
    # Get position and conversation state from user_positions
    position = get_avatar_position(client, avatar_id)
    if not position:
        return None
    
    # Get or create personality
    personality = get_personality(client, avatar_id)
    if not personality:
        personality = generate_random_personality(avatar_id)
        create_personality(client, personality)
    
    # Get or create state
    state = get_state(client, avatar_id)
    if not state:
        state = generate_random_state(avatar_id)
        create_state(client, state)
    
    # Get social memories
    social_memories = get_social_memories(client, avatar_id)
    
    # Get nearby avatars
    nearby_avatars = get_nearby_avatars(client, avatar_id)
    
    # Enrich nearby avatars with social memory data
    memory_map = {m.to_avatar_id: m for m in social_memories}
    for nearby in nearby_avatars:
        if nearby.avatar_id in memory_map:
            memory = memory_map[nearby.avatar_id]
            nearby.sentiment = memory.sentiment
            nearby.familiarity = memory.familiarity
            nearby.last_interaction = memory.last_interaction
    
    # Get world locations
    world_locations = get_all_world_locations(client)
    
    # Get active cooldowns
    active_cooldowns = get_active_cooldowns(client, avatar_id)
    
    # Check conversation state from user_positions (linked table)
    conversation_state = position.get("conversation_state", "IDLE")
    in_conversation = conversation_state == "IN_CONVERSATION"
    
    # Get pending conversation requests
    pending_requests = get_pending_conversation_requests(client, avatar_id)
    
    return AgentContext(
        avatar_id=avatar_id,
        x=position["x"],
        y=position["y"],
        personality=personality,
        state=state,
        social_memories=social_memories,
        nearby_avatars=nearby_avatars,
        world_locations=world_locations,
        active_cooldowns=active_cooldowns,
        in_conversation=in_conversation,
        pending_conversation_requests=pending_requests,
    )


def get_pending_conversation_requests(client: Client, avatar_id: str) -> list[dict]:
    """Get pending conversation requests for an avatar from user_positions."""
    # Check if there are avatars trying to talk to this one
    result = (
        client.table("user_positions")
        .select("user_id, display_name, x, y, is_online")
        .eq("conversation_target_id", avatar_id)
        .eq("conversation_state", "PENDING_REQUEST")
        .execute()
    )
    return [
        {
            "initiator_id": row["user_id"],
            "initiator_name": row.get("display_name"),
            "initiator_type": "PLAYER" if row.get("is_online") else "ROBOT",
            "x": row["x"],
            "y": row["y"],
        }
        for row in result.data or []
    ]


def can_agent_take_action(client: Client, avatar_id: str) -> bool:
    """
    Check if agent can take a new action (linked check across tables).
    Uses the database function for consistency.
    """
    result = client.rpc("can_agent_take_action", {"p_avatar_id": avatar_id}).execute()
    return result.data is True


def set_agent_action(
    client: Client,
    avatar_id: str,
    action: str,
    target: Optional[dict] = None,
    duration_seconds: Optional[int] = None
) -> bool:
    """
    Set an agent's action (validates state first).
    Uses the database function for consistency.
    """
    result = client.rpc("set_agent_action", {
        "p_avatar_id": avatar_id,
        "p_action": action,
        "p_target": target,
        "p_duration_seconds": duration_seconds
    }).execute()
    return result.data is True


def sync_conversation_to_agent(client: Client, avatar_id: str) -> None:
    """
    Sync conversation state from user_positions to agent_state.
    Call this after conversation state changes.
    """
    client.rpc("sync_conversation_to_agent", {"p_avatar_id": avatar_id}).execute()


def get_full_agent_context_from_view(client: Client, avatar_id: str) -> Optional[dict]:
    """
    Get full agent context using the unified view.
    This is a faster alternative to build_agent_context for simple lookups.
    """
    result = (
        client.table("agent_full_context")
        .select("*")
        .eq("avatar_id", avatar_id)
        .execute()
    )
    if result.data and len(result.data) > 0:
        return result.data[0]
    return None


def get_agents_ready_for_action(client: Client, limit: int = 10) -> list[dict]:
    """
    Get offline agents that are ready to take a new action.
    Uses the agents_ready_for_action view.
    """
    result = (
        client.table("agents_ready_for_action")
        .select("avatar_id, display_name, x, y")
        .limit(limit)
        .execute()
    )
    return result.data or []


# ============================================================================
# INITIALIZATION
# ============================================================================

def initialize_agent(client: Client, avatar_id: str, personality: Optional[AgentPersonality] = None) -> tuple[AgentPersonality, AgentState]:
    """Initialize agent data for an avatar."""
    # Create personality
    if personality is None:
        personality = generate_random_personality(avatar_id)
    create_personality(client, personality)
    
    # Create state
    state = generate_random_state(avatar_id)
    create_state(client, state)
    
    return personality, state
