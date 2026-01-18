"""
Agent Decision Engine - Core logic for AI agent decision making

This module implements the utility-based decision system for offline agents.
It scores candidate actions and selects one using softmax probability.
"""

import math
import random
from datetime import datetime, timedelta
from typing import Optional

from .agent_models import (
    ActionType,
    AgentContext,
    AgentPersonality,
    AgentState,
    CandidateAction,
    ActionTarget,
    SelectedAction,
    NearbyAvatar,
    WorldLocation,
    SocialMemory,
    LocationType,
)


# ============================================================================
# CONFIGURATION
# ============================================================================

class DecisionConfig:
    """Configuration for the decision engine"""
    # Scoring weights
    NEED_WEIGHT = 1.0
    PERSONALITY_WEIGHT = 0.6
    SOCIAL_WEIGHT = 0.4
    AFFINITY_WEIGHT = 0.5
    RECENCY_WEIGHT = 0.3
    RANDOMNESS_WEIGHT = 0.2
    
    # Softmax temperature (lower = more deterministic)
    SOFTMAX_TEMPERATURE = 0.5
    
    # Thresholds
    CRITICAL_HUNGER = 0.8
    CRITICAL_ENERGY = 0.15
    HIGH_LONELINESS = 0.7
    
    # Social parameters
    CONVERSATION_RADIUS = 8
    RECENT_INTERACTION_HOURS = 2
    
    # Time decay rates (per tick)
    ENERGY_DECAY = 0.02
    HUNGER_GROWTH = 0.015  # Reduced from 0.03
    LONELINESS_GROWTH = 0.02
    
    # Wander influence parameters
    SOCIAL_WANDER_INFLUENCE = 0.5  # How much sentiment influences wander direction (0-1)
    WANDER_RANDOMNESS = 0.5  # Remaining randomness in wander (should = 1 - SOCIAL_WANDER_INFLUENCE)
    MAP_WIDTH = 75
    MAP_HEIGHT = 56


# ============================================================================
# NEED SATISFACTION CALCULATIONS
# ============================================================================

def calculate_need_satisfaction(action: ActionType, state: AgentState, target: Optional[ActionTarget] = None, location: Optional[WorldLocation] = None) -> float:
    """
    Calculate how much an action satisfies current needs.
    Higher scores for actions that address urgent needs.
    """
    score = 0.0
    
    # Food-related actions
    if action in [ActionType.WALK_TO_LOCATION, ActionType.INTERACT_FOOD]:
        if location and location.location_type == LocationType.FOOD:
            # Higher score when hungrier
            score += state.hunger * 1.5
            # Bonus if critically hungry
            if state.hunger > DecisionConfig.CRITICAL_HUNGER:
                score += 0.5
    
    # Rest-related actions
    if action in [ActionType.WALK_TO_LOCATION, ActionType.INTERACT_REST, ActionType.IDLE]:
        if action == ActionType.IDLE:
            score += (1.0 - state.energy) * 0.3  # Small boost for idle when tired
        elif location and location.location_type == LocationType.REST_AREA:
            score += (1.0 - state.energy) * 1.5
            if state.energy < DecisionConfig.CRITICAL_ENERGY:
                score += 0.5
    
    # Social actions address loneliness
    if action in [ActionType.INITIATE_CONVERSATION, ActionType.JOIN_CONVERSATION]:
        score += state.loneliness * 1.2
        if state.loneliness > DecisionConfig.HIGH_LONELINESS:
            score += 0.4
    
    # Karaoke addresses loneliness and boosts mood
    if action == ActionType.INTERACT_KARAOKE:
        score += state.loneliness * 0.8
        score += (1.0 - state.mood) * 0.5  # More appealing when mood is low
    
    # Wander satisfies curiosity need (implicit)
    if action == ActionType.WANDER:
        score += 0.2  # Base wander appeal
    
    return score


# ============================================================================
# PERSONALITY ALIGNMENT
# ============================================================================

def calculate_personality_alignment(action: ActionType, personality: AgentPersonality, location: Optional[WorldLocation] = None) -> float:
    """
    Calculate how well an action aligns with personality traits.
    """
    score = 0.0
    
    # Sociable personalities prefer social actions
    if action in [ActionType.INITIATE_CONVERSATION, ActionType.JOIN_CONVERSATION]:
        score += personality.sociability * 0.8
    
    # Curious personalities prefer exploration
    if action == ActionType.WANDER:
        score += personality.curiosity * 0.6
    
    # Agreeable personalities more likely to accept conversations
    if action == ActionType.JOIN_CONVERSATION:
        score += personality.agreeableness * 0.3
    
    # Energy baseline affects rest preference
    if action in [ActionType.IDLE, ActionType.INTERACT_REST]:
        # Low energy baseline = prefers rest more
        score += (1.0 - personality.energy_baseline) * 0.4
    
    # High energy baseline = prefers active actions
    if action in [ActionType.WANDER, ActionType.INTERACT_KARAOKE]:
        score += personality.energy_baseline * 0.3
    
    return score


# ============================================================================
# SOCIAL MEMORY BIAS
# ============================================================================

def calculate_social_bias(
    action: ActionType,
    target_avatar: Optional[NearbyAvatar],
    social_memory: Optional[SocialMemory]
) -> float:
    """
    Calculate bias based on relationship with target avatar.
    
    Uses:
    - sentiment: positive = more likely to chat
    - familiarity: more familiar = more comfortable chatting
    - mutual_interests: shared interests = more to talk about
    - relationship_notes: positive dynamic = more likely to interact
    - interaction_count: more interactions = stronger relationship
    """
    if not target_avatar:
        return 0.0
    
    score = 0.0
    
    if social_memory:
        # Positive sentiment increases desire to interact
        if action == ActionType.INITIATE_CONVERSATION:
            score += social_memory.sentiment * 0.5
            # Familiarity makes interaction more comfortable
            score += social_memory.familiarity * 0.3
            
            # More interactions = stronger desire to continue relationship
            if social_memory.interaction_count > 3:
                score += 0.1
            if social_memory.interaction_count > 10:
                score += 0.1  # Extra bonus for established relationships
            
            # Mutual interests give a bonus (more to talk about)
            if hasattr(social_memory, 'mutual_interests') and social_memory.mutual_interests:
                interests = social_memory.mutual_interests
                if isinstance(interests, list) and len(interests) > 0:
                    score += min(len(interests) * 0.05, 0.2)  # Cap at 0.2 bonus
        
        # Very negative sentiment discourages interaction
        if social_memory.sentiment < -0.5:
            score -= 0.5
        
        # AVOID action - score based on how much we dislike them
        if action == ActionType.AVOID_AVATAR:
            # The more negative the sentiment, the higher the avoid score
            # sentiment of -1.0 gives score of 1.5, sentiment of -0.3 gives 0.45
            score += abs(social_memory.sentiment) * 1.5
            # Extra urgency if they're very close
            if target_avatar.distance <= 3:
                score += 0.5
    else:
        # Unknown avatars get curiosity bonus (want to meet new people)
        score += 0.15
    
    # Prefer online players for social interactions
    if target_avatar.is_online and action == ActionType.INITIATE_CONVERSATION:
        score += 0.2
    
    return score


# ============================================================================
# WORLD AFFINITY
# ============================================================================

def calculate_world_affinity(
    action: ActionType,
    personality: AgentPersonality,
    location: Optional[WorldLocation]
) -> float:
    """
    Calculate affinity bonus based on personality preferences for locations.
    """
    if not location:
        return 0.0
    
    affinity = personality.world_affinities.get(location.location_type.value, 0.5)
    
    if action in [ActionType.WALK_TO_LOCATION, ActionType.INTERACT_FOOD, 
                  ActionType.INTERACT_KARAOKE, ActionType.INTERACT_REST]:
        return affinity * 0.8
    
    return 0.0


# ============================================================================
# RECENCY PENALTY
# ============================================================================

def calculate_recency_penalty(
    action: ActionType,
    target_avatar: Optional[NearbyAvatar],
    social_memory: Optional[SocialMemory],
    active_cooldowns: list[str],
    target_location: Optional[WorldLocation]
) -> float:
    """
    Penalize recently performed actions to encourage variety.
    """
    penalty = 0.0
    
    # Penalize talking to same avatar recently
    if action == ActionType.INITIATE_CONVERSATION and social_memory:
        if social_memory.last_interaction:
            last_interaction = social_memory.last_interaction
            # Handle timezone-aware datetimes from database
            if last_interaction.tzinfo is not None:
                last_interaction = last_interaction.replace(tzinfo=None)
            hours_since = (datetime.utcnow() - last_interaction).total_seconds() / 3600
            if hours_since < DecisionConfig.RECENT_INTERACTION_HOURS:
                # Linear decay: full penalty at 0 hours, no penalty at threshold
                penalty += 0.5 * (1.0 - hours_since / DecisionConfig.RECENT_INTERACTION_HOURS)
    
    # Penalize locations on cooldown
    if target_location and target_location.id in active_cooldowns:
        penalty += 1.0  # Strong penalty for cooldown locations
    
    return penalty


# ============================================================================
# SOCIAL-BIASED WANDER CALCULATION
# ============================================================================

def calculate_social_wander_target(context: AgentContext) -> tuple[int, int]:
    """
    Calculate a wander target position influenced by social relationships.
    
    - Moves towards entities with positive sentiment (likes)
    - Moves away from entities with negative sentiment (dislikes)
    - Adds randomness to prevent predictable behavior
    - Considers loneliness (high loneliness = seek out people)
    
    Returns:
        tuple: (x, y) target position
    """
    current_x = context.x
    current_y = context.y
    
    # Start with a random direction as base
    base_angle = random.uniform(0, 2 * math.pi)
    base_distance = random.uniform(5, 15)
    
    # Calculate social influence vector
    social_dx = 0.0
    social_dy = 0.0
    total_weight = 0.0
    
    for nearby in context.nearby_avatars:
        # Find sentiment for this avatar
        memory = next(
            (m for m in context.social_memories if m.to_avatar_id == nearby.avatar_id),
            None
        )
        
        # Calculate direction to/from this avatar
        dx = nearby.x - current_x
        dy = nearby.y - current_y
        distance = max(1, nearby.distance)
        
        # Normalize direction
        if distance > 0:
            dx_norm = dx / distance
            dy_norm = dy / distance
        else:
            continue
        
        # Determine influence based on sentiment
        if memory:
            sentiment = memory.sentiment
            familiarity = memory.familiarity
        else:
            # Unknown person - slight attraction if lonely, neutral otherwise
            sentiment = 0.1 if context.state.loneliness > 0.5 else 0.0
            familiarity = 0.0
        
        # Calculate weight based on distance (closer = more influence)
        distance_weight = 1.0 / (1.0 + distance * 0.1)
        
        # Sentiment determines direction:
        # Positive sentiment -> move towards (attraction)
        # Negative sentiment -> move away (repulsion)
        influence_strength = sentiment * distance_weight
        
        # Familiarity increases the influence
        influence_strength *= (1.0 + familiarity * 0.5)
        
        # High loneliness makes positive sentiments more attractive
        if sentiment > 0 and context.state.loneliness > 0.5:
            influence_strength *= (1.0 + context.state.loneliness)
        
        # Low mood makes negative sentiments more repulsive
        if sentiment < 0 and context.state.mood < 0.3:
            influence_strength *= 1.5
        
        # Accumulate social influence
        social_dx += dx_norm * influence_strength
        social_dy += dy_norm * influence_strength
        total_weight += abs(influence_strength)
    
    # Normalize social influence vector if we had any influences
    if total_weight > 0:
        social_dx /= total_weight
        social_dy /= total_weight
        
        # Scale to reasonable movement distance
        social_magnitude = math.sqrt(social_dx**2 + social_dy**2)
        if social_magnitude > 0:
            social_dx = (social_dx / social_magnitude) * base_distance
            social_dy = (social_dy / social_magnitude) * base_distance
    
    # Calculate random component
    random_dx = math.cos(base_angle) * base_distance
    random_dy = math.sin(base_angle) * base_distance
    
    # Blend social and random influences
    social_weight = DecisionConfig.SOCIAL_WANDER_INFLUENCE
    random_weight = DecisionConfig.WANDER_RANDOMNESS
    
    # If no nearby avatars, just use random
    if len(context.nearby_avatars) == 0:
        final_dx = random_dx
        final_dy = random_dy
    else:
        final_dx = social_dx * social_weight + random_dx * random_weight
        final_dy = social_dy * social_weight + random_dy * random_weight
    
    # Calculate final target position
    target_x = int(current_x + final_dx)
    target_y = int(current_y + final_dy)
    
    # Clamp to map bounds with some margin
    target_x = max(2, min(DecisionConfig.MAP_WIDTH - 2, target_x))
    target_y = max(2, min(DecisionConfig.MAP_HEIGHT - 2, target_y))
    
    return (target_x, target_y)


# ============================================================================
# ACTION GENERATION
# ============================================================================

def generate_candidate_actions(context: AgentContext) -> list[CandidateAction]:
    """
    Generate all feasible actions for the current context.
    """
    actions: list[CandidateAction] = []
    
    # Always available: Idle
    actions.append(CandidateAction(
        action_type=ActionType.IDLE,
        target=None
    ))
    
    # Always available: Wander (with social-biased target)
    wander_x, wander_y = calculate_social_wander_target(context)
    actions.append(CandidateAction(
        action_type=ActionType.WANDER,
        target=ActionTarget(
            target_type="position",
            x=wander_x,
            y=wander_y
        )
    ))
    
    # World location actions
    for location in context.world_locations:
        # Skip if on cooldown
        if location.id in context.active_cooldowns:
            continue
        
        # Calculate distance
        distance = math.sqrt((location.x - context.x) ** 2 + (location.y - context.y) ** 2)
        
        # Determine action type based on location type and distance
        if distance <= 2:
            # At location - can interact directly
            if location.location_type == LocationType.FOOD:
                action_type = ActionType.INTERACT_FOOD
            elif location.location_type == LocationType.KARAOKE:
                action_type = ActionType.INTERACT_KARAOKE
            elif location.location_type == LocationType.REST_AREA:
                action_type = ActionType.INTERACT_REST
            else:
                continue
        else:
            # Need to walk to location first
            action_type = ActionType.WALK_TO_LOCATION
        
        actions.append(CandidateAction(
            action_type=action_type,
            target=ActionTarget(
                target_type="location",
                target_id=location.id,
                name=location.name,
                x=location.x,
                y=location.y
            )
        ))
    
    # Social actions - only if not in conversation
    if not context.in_conversation:
        for nearby in context.nearby_avatars:
            # Check social memory for this avatar
            memory = next(
                (m for m in context.social_memories if m.to_avatar_id == nearby.avatar_id),
                None
            )
            
            # If we dislike them (sentiment < -0.3), consider avoiding
            if memory and memory.sentiment < -0.3 and nearby.distance <= DecisionConfig.CONVERSATION_RADIUS + 4:
                # Calculate position to move away from them
                dx = context.x - nearby.x
                dy = context.y - nearby.y
                # Normalize and move 5 units away
                dist = max(1, (dx**2 + dy**2) ** 0.5)
                flee_x = int(context.x + (dx / dist) * 5)
                flee_y = int(context.y + (dy / dist) * 5)
                # Clamp to map bounds (assuming 75x56)
                flee_x = max(1, min(73, flee_x))
                flee_y = max(1, min(54, flee_y))
                
                actions.append(CandidateAction(
                    action_type=ActionType.AVOID_AVATAR,
                    target=ActionTarget(
                        target_type="avatar",
                        target_id=nearby.avatar_id,
                        name=f"away from {nearby.avatar_id[:8]}",
                        x=flee_x,
                        y=flee_y
                    )
                ))
            # If we like them or neutral, consider talking
            elif nearby.distance <= DecisionConfig.CONVERSATION_RADIUS:
                actions.append(CandidateAction(
                    action_type=ActionType.INITIATE_CONVERSATION,
                    target=ActionTarget(
                        target_type="avatar",
                        target_id=nearby.avatar_id,
                        x=nearby.x,
                        y=nearby.y
                    )
                ))
    
    # Leave conversation if in one
    if context.in_conversation:
        actions.append(CandidateAction(
            action_type=ActionType.LEAVE_CONVERSATION,
            target=None
        ))
    
    return actions


# ============================================================================
# ACTION SCORING
# ============================================================================

def score_action(
    action: CandidateAction,
    context: AgentContext
) -> CandidateAction:
    """
    Score a candidate action based on all factors.
    Returns the action with scores filled in.
    """
    # Find relevant data for this action
    target_avatar: Optional[NearbyAvatar] = None
    target_location: Optional[WorldLocation] = None
    social_memory: Optional[SocialMemory] = None
    
    if action.target:
        if action.target.target_type == "avatar" and action.target.target_id:
            target_avatar = next(
                (a for a in context.nearby_avatars if a.avatar_id == action.target.target_id),
                None
            )
            social_memory = next(
                (m for m in context.social_memories if m.to_avatar_id == action.target.target_id),
                None
            )
        elif action.target.target_type == "location" and action.target.target_id:
            target_location = next(
                (l for l in context.world_locations if l.id == action.target.target_id),
                None
            )
    
    # Calculate each component
    action.need_satisfaction = calculate_need_satisfaction(
        action.action_type, context.state, action.target, target_location
    ) * DecisionConfig.NEED_WEIGHT
    
    action.personality_alignment = calculate_personality_alignment(
        action.action_type, context.personality, target_location
    ) * DecisionConfig.PERSONALITY_WEIGHT
    
    action.social_memory_bias = calculate_social_bias(
        action.action_type, target_avatar, social_memory
    ) * DecisionConfig.SOCIAL_WEIGHT
    
    action.world_affinity = calculate_world_affinity(
        action.action_type, context.personality, target_location
    ) * DecisionConfig.AFFINITY_WEIGHT
    
    action.recency_penalty = calculate_recency_penalty(
        action.action_type, target_avatar, social_memory,
        context.active_cooldowns, target_location
    ) * DecisionConfig.RECENCY_WEIGHT
    
    # Add controlled randomness
    action.randomness = random.gauss(0, 0.1) * DecisionConfig.RANDOMNESS_WEIGHT
    
    # Calculate total utility
    action.utility_score = (
        action.need_satisfaction
        + action.personality_alignment
        + action.social_memory_bias
        + action.world_affinity
        - action.recency_penalty
        + action.randomness
    )
    
    return action


def score_all_actions(actions: list[CandidateAction], context: AgentContext) -> list[CandidateAction]:
    """Score all candidate actions."""
    return [score_action(action, context) for action in actions]


# ============================================================================
# ACTION SELECTION
# ============================================================================

def softmax_select(actions: list[CandidateAction], temperature: float = DecisionConfig.SOFTMAX_TEMPERATURE) -> CandidateAction:
    """
    Select an action using softmax probability distribution.
    Lower temperature = more deterministic (favors highest score).
    Higher temperature = more random.
    """
    if not actions:
        raise ValueError("No actions to select from")
    
    if len(actions) == 1:
        return actions[0]
    
    # Get scores and apply temperature
    scores = [a.utility_score / temperature for a in actions]
    
    # Numerical stability: subtract max
    max_score = max(scores)
    exp_scores = [math.exp(s - max_score) for s in scores]
    sum_exp = sum(exp_scores)
    
    # Convert to probabilities
    probabilities = [e / sum_exp for e in exp_scores]
    
    # Sample from distribution
    r = random.random()
    cumulative = 0.0
    for action, prob in zip(actions, probabilities):
        cumulative += prob
        if r <= cumulative:
            return action
    
    # Fallback to last action (shouldn't happen)
    return actions[-1]


# ============================================================================
# INTERRUPT HANDLING
# ============================================================================

def check_for_interrupts(context: AgentContext) -> Optional[SelectedAction]:
    """
    Check for conditions that should interrupt normal decision making.
    Returns an action if an interrupt is triggered, None otherwise.
    """
    state = context.state
    
    # Critical hunger - must eat
    if state.hunger > DecisionConfig.CRITICAL_HUNGER:
        food_locations = [l for l in context.world_locations 
                        if l.location_type == LocationType.FOOD 
                        and l.id not in context.active_cooldowns]
        if food_locations:
            # Pick closest food location
            closest = min(food_locations, key=lambda l: math.sqrt((l.x - context.x)**2 + (l.y - context.y)**2))
            return SelectedAction(
                action_type=ActionType.WALK_TO_LOCATION,
                target=ActionTarget(target_type="location", target_id=closest.id, x=closest.x, y=closest.y),
                utility_score=10.0  # High priority
            )
    
    # Critical energy - must rest
    if state.energy < DecisionConfig.CRITICAL_ENERGY:
        rest_locations = [l for l in context.world_locations 
                         if l.location_type == LocationType.REST_AREA 
                         and l.id not in context.active_cooldowns]
        if rest_locations:
            closest = min(rest_locations, key=lambda l: math.sqrt((l.x - context.x)**2 + (l.y - context.y)**2))
            return SelectedAction(
                action_type=ActionType.WALK_TO_LOCATION,
                target=ActionTarget(target_type="location", target_id=closest.id, x=closest.x, y=closest.y),
                utility_score=10.0
            )
        else:
            # No rest area available, just idle
            return SelectedAction(
                action_type=ActionType.IDLE,
                target=None,
                utility_score=5.0,
                duration_seconds=30.0
            )
    
    # Pending conversation requests from players should be auto-accepted based on agreeableness
    if context.pending_conversation_requests:
        for request in context.pending_conversation_requests:
            initiator_type = request.get("initiator_type", "ROBOT")
            # Always accept from human players
            if initiator_type == "PLAYER":
                return SelectedAction(
                    action_type=ActionType.JOIN_CONVERSATION,
                    target=ActionTarget(
                        target_type="avatar",
                        target_id=request.get("initiator_id")
                    ),
                    utility_score=10.0
                )
            # For robots, check agreeableness
            elif random.random() < context.personality.agreeableness:
                return SelectedAction(
                    action_type=ActionType.JOIN_CONVERSATION,
                    target=ActionTarget(
                        target_type="avatar",
                        target_id=request.get("initiator_id")
                    ),
                    utility_score=5.0
                )
    
    return None


# ============================================================================
# MAIN DECISION FUNCTION
# ============================================================================

def make_decision(context: AgentContext) -> SelectedAction:
    """
    Main decision function for an agent.
    
    1. Check for interrupts
    2. Generate candidate actions
    3. Score all actions
    4. Select action using softmax
    
    Returns the selected action.
    """
    # Check for interrupts first
    interrupt_action = check_for_interrupts(context)
    if interrupt_action:
        return interrupt_action
    
    # Generate and score candidate actions
    candidates = generate_candidate_actions(context)
    scored = score_all_actions(candidates, context)
    
    # Filter out negative utility actions (unless all are negative)
    positive_actions = [a for a in scored if a.utility_score > 0]
    if positive_actions:
        scored = positive_actions
    
    # Select using softmax
    selected = softmax_select(scored)
    
    # Convert to SelectedAction with duration
    duration = calculate_action_duration(selected.action_type)
    
    return SelectedAction(
        action_type=selected.action_type,
        target=selected.target,
        utility_score=selected.utility_score,
        duration_seconds=duration
    )


def calculate_action_duration(action_type: ActionType) -> float:
    """Calculate how long an action should take."""
    durations = {
        ActionType.IDLE: 30.0,
        ActionType.WANDER: 60.0,
        ActionType.WALK_TO_LOCATION: 45.0,
        ActionType.INTERACT_FOOD: 45.0,
        ActionType.INTERACT_KARAOKE: 60.0,
        ActionType.INTERACT_REST: 30.0,
        ActionType.INITIATE_CONVERSATION: 120.0,
        ActionType.JOIN_CONVERSATION: 120.0,
        ActionType.LEAVE_CONVERSATION: 5.0,
        ActionType.MOVE: 30.0,
        ActionType.STAND_STILL: 15.0,
    }
    return durations.get(action_type, 30.0)


# ============================================================================
# STATE UPDATES
# ============================================================================

def apply_state_decay(state: AgentState, elapsed_seconds: float) -> AgentState:
    """
    Apply natural decay/growth to agent needs over time.
    Called at the start of each tick.
    """
    # Calculate number of "ticks" worth of decay (normalized to 5 minute intervals)
    tick_factor = elapsed_seconds / 300.0
    
    # Energy decays
    new_energy = max(0.0, state.energy - DecisionConfig.ENERGY_DECAY * tick_factor)
    
    # Hunger grows
    new_hunger = min(1.0, state.hunger + DecisionConfig.HUNGER_GROWTH * tick_factor)
    
    # Loneliness grows (slower than hunger)
    new_loneliness = min(1.0, state.loneliness + DecisionConfig.LONELINESS_GROWTH * tick_factor)
    
    # Mood slowly drifts toward neutral
    new_mood = state.mood * (1.0 - 0.01 * tick_factor)
    
    return AgentState(
        avatar_id=state.avatar_id,
        energy=new_energy,
        hunger=new_hunger,
        loneliness=new_loneliness,
        mood=new_mood,
        current_action=state.current_action,
        current_action_target=state.current_action_target,
        action_started_at=state.action_started_at,
        action_expires_at=state.action_expires_at,
        last_tick=state.last_tick,
        tick_lock_until=state.tick_lock_until,
        created_at=state.created_at,
        updated_at=datetime.utcnow()
    )


def apply_interaction_effects(state: AgentState, effects: dict[str, float]) -> AgentState:
    """
    Apply effects from a world interaction to agent state.
    Effects dict maps need names to delta values.
    """
    new_energy = max(0.0, min(1.0, state.energy + effects.get("energy", 0)))
    new_hunger = max(0.0, min(1.0, state.hunger + effects.get("hunger", 0)))
    new_loneliness = max(0.0, min(1.0, state.loneliness + effects.get("loneliness", 0)))
    new_mood = max(-1.0, min(1.0, state.mood + effects.get("mood", 0)))
    
    return AgentState(
        avatar_id=state.avatar_id,
        energy=new_energy,
        hunger=new_hunger,
        loneliness=new_loneliness,
        mood=new_mood,
        current_action=state.current_action,
        current_action_target=state.current_action_target,
        action_started_at=state.action_started_at,
        action_expires_at=state.action_expires_at,
        last_tick=state.last_tick,
        tick_lock_until=state.tick_lock_until,
        created_at=state.created_at,
        updated_at=datetime.utcnow()
    )
