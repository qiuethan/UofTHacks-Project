"""
Database operations for the Agent Decision System using Supabase

TABLE UPDATE RESPONSIBILITIES (see 009_agent_decision_system.sql for details):

┌─────────────────────┬────────────────────────────────────────────────────────┐
│ TABLE               │ FUNCTION(S) THAT UPDATE IT                             │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ agent_personality   │ create_personality() - called on avatar creation       │
│ agent_state         │ create_state() - initial                               │
│                     │ update_state() - after actions ✅                      │
│                     │ (decay applied in agent_worker.py) ✅                  │
│                     │ apply_location_effects() - TODO: when action completes │
│ agent_social_memory │ update_social_memory() - TODO: after conversations     │
│ world_interactions  │ start_location_interaction() - TODO                    │
│                     │ complete_location_interaction() - TODO                 │
│ agent_decisions     │ log_decision() - debug mode only ⚠️                    │
└─────────────────────┴────────────────────────────────────────────────────────┘

TODO LIST:
- [ ] Implement apply_location_effects() - apply effects when location action completes
- [ ] Implement update_social_memory() - call from realtime-server after conversation
- [ ] Implement start_location_interaction() / complete_location_interaction()
- [ ] Consider always calling log_decision() (currently debug-only)
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
        # Parse interests if it's a string
        interests = row.get("interests")
        if isinstance(interests, str):
            try:
                import json
                interests = json.loads(interests)
            except:
                interests = []
        
        # Parse conversation_topics if it's a string
        conversation_topics = row.get("conversation_topics")
        if isinstance(conversation_topics, str):
            try:
                import json
                conversation_topics = json.loads(conversation_topics)
            except:
                conversation_topics = []
        
        # Parse world_affinities if it's a string (JSON from database)
        world_affinities = row.get("world_affinities", {})
        if isinstance(world_affinities, str):
            try:
                import json
                world_affinities = json.loads(world_affinities)
            except:
                world_affinities = {"food": 0.5, "karaoke": 0.5, "rest_area": 0.5, "social_hub": 0.5, "wander_point": 0.5}
        
        return AgentPersonality(
            avatar_id=row["avatar_id"],
            sociability=row["sociability"],
            curiosity=row["curiosity"],
            agreeableness=row["agreeableness"],
            energy_baseline=row["energy_baseline"],
            world_affinities=world_affinities,
            profile_summary=row.get("profile_summary"),
            communication_style=row.get("communication_style"),
            interests=interests,
            conversation_topics=conversation_topics,
            personality_notes=row.get("personality_notes"),
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


def generate_default_personality(avatar_id: str) -> AgentPersonality:
    """
    Generate a personality for a new avatar.
    
    First tries to load from agent_personality table (populated from onboarding).
    Only uses neutral defaults if no onboarding data exists.
    """
    # First, try to get existing personality from database (from onboarding)
    try:
        from .supabase_client import supabase
        result = supabase.table("agent_personality").select("*").eq("avatar_id", avatar_id).execute()
        if result.data and len(result.data) > 0:
            row = result.data[0]
            print(f"[Personality] Found existing personality for {avatar_id[:8]} from onboarding")
            
            # Parse JSON fields
            interests = row.get("interests")
            if isinstance(interests, str):
                try:
                    import json
                    interests = json.loads(interests)
                except:
                    interests = []
            
            conversation_topics = row.get("conversation_topics")
            if isinstance(conversation_topics, str):
                try:
                    import json
                    conversation_topics = json.loads(conversation_topics)
                except:
                    conversation_topics = []
            
            # Parse world_affinities if it's a string (JSON from database)
            world_affinities = row.get("world_affinities", {
                "food": 0.5, "karaoke": 0.5, "rest_area": 0.5, 
                "social_hub": 0.5, "wander_point": 0.5
            })
            if isinstance(world_affinities, str):
                try:
                    world_affinities = json.loads(world_affinities)
                except:
                    world_affinities = {"food": 0.5, "karaoke": 0.5, "rest_area": 0.5, "social_hub": 0.5, "wander_point": 0.5}
            
            return AgentPersonality(
                avatar_id=avatar_id,
                sociability=row.get("sociability", 0.85),
                curiosity=row.get("curiosity", 0.8),
                agreeableness=row.get("agreeableness", 0.8),
                energy_baseline=row.get("energy_baseline", 0.85),
                world_affinities=world_affinities,
                profile_summary=row.get("profile_summary"),
                communication_style=row.get("communication_style"),
                interests=interests,
                conversation_topics=conversation_topics,
                personality_notes=row.get("personality_notes"),
            )
    except Exception as e:
        print(f"[Personality] Error loading personality for {avatar_id[:8]}: {e}")
    
    # Fallback: use high positive defaults - agents should be ACTIVE!
    print(f"[Personality] No onboarding data for {avatar_id[:8]}, using active/social defaults")
    return AgentPersonality(
        avatar_id=avatar_id,
        sociability=0.85,       # VERY social - loves talking!
        curiosity=0.8,          # Very curious - loves exploring
        agreeableness=0.8,      # Generally agreeable
        energy_baseline=0.85,   # High energy - always active
        world_affinities={
            "food": 0.8,         # Loves eating
            "karaoke": 0.85,     # Loves singing!
            "rest_area": 0.4,    # Less interest in resting
            "social_hub": 0.9,   # LOVES social areas
            "wander_point": 0.75, # Enjoys wandering
        }
    )


# Alias for backward compatibility
generate_random_personality = generate_default_personality


def update_personality_from_survey(
    client: Client,
    avatar_id: str,
    sociability: float,
    curiosity: float,
    agreeableness: float,
    energy_baseline: float,
    world_affinities: dict[str, float]
) -> bool:
    """
    TODO: Update personality from intro survey results.
    
    Call this after the user completes the intro survey to set their
    actual personality values instead of the neutral defaults.
    
    Args:
        client: Supabase client
        avatar_id: The avatar to update
        sociability: 0.0 (introvert) to 1.0 (extrovert)
        curiosity: 0.0 (routine) to 1.0 (explorer)
        agreeableness: 0.0 (disagreeable) to 1.0 (agreeable)
        energy_baseline: 0.0 (low energy) to 1.0 (high energy)
        world_affinities: dict of location_type -> affinity (0.0 to 1.0)
    
    Returns:
        True if updated, False if failed
    """
    try:
        client.table("agent_personality").update({
            "sociability": sociability,
            "curiosity": curiosity,
            "agreeableness": agreeableness,
            "energy_baseline": energy_baseline,
            "world_affinities": world_affinities,
            "updated_at": datetime.utcnow().isoformat()
        }).eq("avatar_id", avatar_id).execute()
        return True
    except Exception:
        return False


# ============================================================================
# STATE OPERATIONS
# ============================================================================

def get_state(client: Client, avatar_id: str) -> Optional[AgentState]:
    """Get agent state for an avatar."""
    result = client.table("agent_state").select("*").eq("avatar_id", avatar_id).execute()
    if result.data and len(result.data) > 0:
        row = result.data[0]
        # Handle None values properly - use "idle" as default if current_action is None
        current_action = row.get("current_action")
        if current_action is None:
            current_action = "idle"
        return AgentState(
            avatar_id=row["avatar_id"],
            energy=row.get("energy", 0.8),
            hunger=row.get("hunger", 0.3),
            loneliness=row.get("loneliness", 0.3),
            mood=row.get("mood", 0.5),
            current_action=current_action,
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
    """Generate healthy initial state for an avatar.
    
    All users start with optimal stats (100%) so they don't complain
    about being tired/hungry/lonely immediately.
    """
    return AgentState(
        avatar_id=avatar_id,
        energy=1.0,       # Fully rested - 100%
        hunger=0.0,       # Not hungry - 0%
        loneliness=0.0,   # Not lonely - 0%
        mood=1.0,         # Great mood - 100%
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
        # Parse mutual_interests if it's a string
        mutual_interests = row.get("mutual_interests")
        if isinstance(mutual_interests, str):
            try:
                import json
                mutual_interests = json.loads(mutual_interests)
            except:
                mutual_interests = []
        
        return SocialMemory(
            id=row["id"],
            from_avatar_id=row["from_avatar_id"],
            to_avatar_id=row["to_avatar_id"],
            sentiment=row["sentiment"],
            familiarity=row["familiarity"],
            interaction_count=row.get("interaction_count", 0),
            last_interaction=row.get("last_interaction"),
            last_conversation_topic=row.get("last_conversation_topic"),
            mutual_interests=mutual_interests,
            conversation_history_summary=row.get("conversation_history_summary"),
            relationship_notes=row.get("relationship_notes"),
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
        # Create new - start with neutral sentiment (0.5) then apply delta
        new_id = str(uuid.uuid4())
        initial_sentiment = max(-1.0, min(1.0, 0.5 + sentiment_delta))  # Start at 0.5 neutral
        initial_familiarity = max(0.0, min(1.0, familiarity_delta))
        
        data = {
            "id": new_id,
            "from_avatar_id": from_avatar_id,
            "to_avatar_id": to_avatar_id,
            "sentiment": initial_sentiment,
            "familiarity": initial_familiarity,
            "interaction_count": 1,
            "last_interaction": datetime.utcnow().isoformat(),
            "last_conversation_topic": conversation_topic,
        }
        client.table("agent_social_memory").insert(data).execute()
        
        return SocialMemory(
            id=new_id,
            from_avatar_id=from_avatar_id,
            to_avatar_id=to_avatar_id,
            sentiment=initial_sentiment,
            familiarity=initial_familiarity,
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

def get_nearby_avatars(client: Client, avatar_id: str, radius: int = 5) -> list[NearbyAvatar]:
    """Get avatars near a specific avatar. Radius 5 = must be close to consider conversation."""
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


# ============================================================================
# TODO: MISSING FUNCTIONS - Implement these to complete the system
# ============================================================================

def apply_location_effects(client: Client, avatar_id: str, location_id: str) -> bool:
    """
    TODO: Apply location effects to agent state when action completes.
    
    Called when: Agent completes a location interaction (action_expires_at passes)
    Updates: agent_state (energy, hunger, loneliness, mood based on location.effects)
    
    Example:
        # When agent finishes at Cafe
        apply_location_effects(client, avatar_id, cafe_location_id)
        # This applies: {hunger: -0.4, mood: +0.1, energy: +0.1}
    """
    # TODO: Implement this function
    # 1. Get location effects: SELECT effects FROM world_locations WHERE id = location_id
    # 2. Apply to agent_state: UPDATE agent_state SET energy = energy + effects.energy, ...
    # 3. Mark world_interaction as completed
    raise NotImplementedError("apply_location_effects not yet implemented")


def update_social_memory_after_conversation(
    client: Client,
    avatar_a: str,
    avatar_b: str,
    sentiment_delta: float = 0.0,
    topic: Optional[str] = None
) -> None:
    """
    TODO: Update social memory after a conversation ends.
    
    Called when: Conversation ends (from realtime-server)
    Updates: agent_social_memory (both directions: A->B and B->A)
    
    Args:
        avatar_a: First participant
        avatar_b: Second participant  
        sentiment_delta: How the conversation affected sentiment (-1 to 1)
        topic: What they talked about (for memory)
    
    Example:
        # After a friendly chat
        update_social_memory_after_conversation(
            client, 
            avatar_a="luna-123", 
            avatar_b="bob-456",
            sentiment_delta=0.1,  # Positive interaction
            topic="favorite foods"
        )
    """
    # TODO: Implement this function
    # 1. UPSERT into agent_social_memory for A->B:
    #    - Increment interaction_count
    #    - Add sentiment_delta to sentiment (clamped -1 to 1)
    #    - Increase familiarity by ~0.05 (clamped 0 to 1)
    #    - Update last_interaction = NOW()
    #    - Set last_conversation_topic = topic
    # 2. Same for B->A
    raise NotImplementedError("update_social_memory_after_conversation not yet implemented")


def start_location_interaction(
    client: Client, 
    avatar_id: str, 
    location_id: str
) -> Optional[str]:
    """
    TODO: Start a location interaction (creates cooldown entry).
    
    Called when: Agent arrives at location and begins interaction
    Updates: world_interactions (INSERT new record)
    Returns: interaction_id or None if on cooldown
    
    Example:
        interaction_id = start_location_interaction(client, avatar_id, cafe_id)
        if interaction_id:
            # Started successfully
        else:
            # Still on cooldown, can't interact yet
    """
    # TODO: Implement this function
    # 1. Check if avatar is on cooldown for this location
    # 2. If not, INSERT into world_interactions with cooldown_until
    # 3. Return interaction_id
    raise NotImplementedError("start_location_interaction not yet implemented")


def complete_location_interaction(client: Client, interaction_id: str) -> None:
    """
    TODO: Complete a location interaction (apply effects, mark done).
    
    Called when: Interaction duration passes
    Updates: world_interactions (set completed_at), agent_state (apply effects)
    
    Example:
        complete_location_interaction(client, interaction_id)
    """
    # TODO: Implement this function
    # 1. Get interaction and location
    # 2. Call apply_location_effects()
    # 3. UPDATE world_interactions SET completed_at = NOW()
    raise NotImplementedError("complete_location_interaction not yet implemented")
