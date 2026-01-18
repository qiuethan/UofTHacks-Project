"""
Agent Decision Engine - Core logic for AI agent decision making

This module implements the utility-based decision system for offline agents.
It scores candidate actions and selects one using softmax probability.
"""

import math
import random
from datetime import datetime
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
)


# ============================================================================
# CONFIGURATION
# ============================================================================

class DecisionConfig:
    """Configuration for the decision engine"""
    # Scoring weights - BALANCED for both chatting AND movement
    NEED_WEIGHT = 1.0
    PERSONALITY_WEIGHT = 0.5
    SOCIAL_WEIGHT = 2.0  # High but not overwhelming
    AFFINITY_WEIGHT = 0.0  # DISABLED - no location affinity for agents
    RECENCY_WEIGHT = 0.1  # Some recency penalty - don't always talk to same person
    RANDOMNESS_WEIGHT = 0.3  # More randomness for varied behavior
    
    # DISABLED: All location activities for agents (humans only)
    ACTIVITY_BASE_BONUS = -100.0  # HUGE PENALTY - agents never use locations!
    
    # Conversation bonus - BALANCED with movement
    CONVERSATION_BASE_BONUS = 8.0  # High but balanced with movement
    
    # Movement bonus - EQUALLY HIGH as conversation!
    MOVEMENT_BASE_BONUS = 8.0  # Equal to conversation - agents love walking around!
    
    # Softmax temperature (higher = more varied choices)
    SOFTMAX_TEMPERATURE = 0.3  # More randomness for varied behavior
    
    # Thresholds - ALL DISABLED for agents
    CRITICAL_HUNGER = 1.1  # Impossible to reach - never hungry
    CRITICAL_ENERGY = 0.0  # DISABLED - never tired
    HIGH_LONELINESS = 0.3  # Normal threshold
    LOW_MOOD = 0.3  # Not used
    
    # Social parameters - balanced
    CONVERSATION_RADIUS = 15  # Reasonable conversation distance
    SOCIAL_APPROACH_RADIUS = 30  # Move towards others from moderate distance
    RECENT_INTERACTION_HOURS = 0.05  # ~3 minutes before talking to same person again
    
    # Time decay rates (per tick)
    ENERGY_DECAY = 0.0  # DISABLED - energy always 100%
    HUNGER_GROWTH = 0.0  # DISABLED - never get hungry
    LONELINESS_GROWTH = 0.02  # Moderate - builds up over time
    
    # Wander influence parameters - balanced exploration
    SOCIAL_WANDER_INFLUENCE = 0.5  # Balanced - sometimes social, sometimes random
    WANDER_RANDOMNESS = 0.5  # Equal random exploration
    MAP_WIDTH = 60
    MAP_HEIGHT = 40
    
    # Conversation duration limits (for natural ending)
    MIN_CONVERSATION_MESSAGES = 3  # At least 3 messages before ending
    MAX_CONVERSATION_MESSAGES = 12  # End after ~12 messages to keep moving
    CONVERSATION_END_CHANCE = 0.15  # 15% chance to end after each message (if min met)


# ============================================================================
# NEED SATISFACTION CALCULATIONS
# ============================================================================

def calculate_need_satisfaction(action: ActionType, state: AgentState, target: Optional[ActionTarget] = None, location: Optional[WorldLocation] = None) -> float:
    """
    Calculate how much an action satisfies current needs.
    
    BALANCED AGENT BEHAVIOR:
    - Location activities DISABLED (humans only)
    - Agents chat AND walk around equally
    - Agents should end conversations naturally to keep moving
    """
    score = 0.0
    
    # =========================================================================
    # DISABLED: ALL LOCATION INTERACTIONS FOR AGENTS (humans only!)
    # =========================================================================
    if action in [ActionType.INTERACT_FOOD, ActionType.INTERACT_KARAOKE,
                  ActionType.INTERACT_REST, ActionType.INTERACT_SOCIAL_HUB, 
                  ActionType.INTERACT_WANDER_POINT]:
        score -= 100.0  # MASSIVE PENALTY - agents NEVER use locations!
    
    if action == ActionType.WALK_TO_LOCATION:
        score -= 100.0  # MASSIVE PENALTY - agents NEVER walk to locations!
    
    # =========================================================================
    # SOCIAL ACTIONS - Agents enjoy chatting (balanced with movement)
    # =========================================================================
    if action in [ActionType.INITIATE_CONVERSATION, ActionType.JOIN_CONVERSATION]:
        score += DecisionConfig.CONVERSATION_BASE_BONUS  # 8.0 base
        score += state.loneliness * 3.0  # Loneliness makes chatting more appealing
        score += 2.0  # Base desire to chat
    
    # Leaving conversation - becomes appealing over time
    if action == ActionType.LEAVE_CONVERSATION:
        # Base appeal increases when not lonely (had enough chatting)
        score += (1.0 - state.loneliness) * 3.0
        score += 1.0  # Small base appeal to end conversations
    
    # =========================================================================
    # MOVEMENT - Agents LOVE walking around (equal to chatting!)
    # =========================================================================
    if action == ActionType.MOVE:
        score += DecisionConfig.MOVEMENT_BASE_BONUS  # 8.0 base - EQUAL to chat!
        score += state.loneliness * 2.0  # Move towards people when lonely
        score += 3.0  # Strong base desire to move
    
    # Wander - exploring the map freely
    if action == ActionType.WANDER:
        score += DecisionConfig.MOVEMENT_BASE_BONUS * 0.8  # 6.4 base - almost as good as move
        score += 2.0  # Base desire to explore
        # More appealing when not lonely (already chatted enough)
        score += (1.0 - state.loneliness) * 2.0
    
    # =========================================================================
    # Idle and Stand Still - HEAVILY DISCOURAGED! Always be active!
    # =========================================================================
    if action == ActionType.IDLE:
        score -= 50.0  # HUGE penalty - never idle!
    
    if action == ActionType.STAND_STILL:
        score -= 50.0  # HUGE penalty - never stand still!
    
    return score


# ============================================================================
# PERSONALITY ALIGNMENT
# ============================================================================

def calculate_personality_alignment(action: ActionType, personality: AgentPersonality, location: Optional[WorldLocation] = None) -> float:
    """
    Calculate how well an action aligns with personality traits.
    Agents should be ACTIVE and SOCIAL!
    """
    score = 0.0
    
    # Sociable personalities LOVE social actions - this is the CORE experience!
    if action in [ActionType.INITIATE_CONVERSATION, ActionType.JOIN_CONVERSATION]:
        score += personality.sociability * 2.0  # EXTREMELY HIGH - agents LOVE talking!
        score += 1.0  # Everyone enjoys chatting - big bonus!
    
    # Curious personalities prefer exploration and wandering
    if action == ActionType.WANDER:
        score += personality.curiosity * 1.0  # HIGH - curious agents love to explore
        score += personality.energy_baseline * 0.3  # More energy = more wandering
        score += 0.4  # Everyone enjoys wandering around!
    
    # Agreeable personalities more likely to accept AND initiate conversations
    if action == ActionType.JOIN_CONVERSATION:
        score += personality.agreeableness * 0.8  # Very agreeable = loves joining chats
    if action == ActionType.INITIATE_CONVERSATION:
        score += personality.agreeableness * 0.5  # Agreeable = friendly initiator
    
    # Energy baseline affects rest preference (LOWER scores for rest)
    if action in [ActionType.IDLE, ActionType.INTERACT_REST]:
        # High energy baseline = LESS interested in rest
        score += (1.0 - personality.energy_baseline) * 0.3
    
    # High energy baseline = prefers ALL active actions
    if action in [ActionType.WANDER, ActionType.INTERACT_KARAOKE, ActionType.INTERACT_WANDER_POINT, 
                  ActionType.INTERACT_FOOD, ActionType.INTERACT_SOCIAL_HUB]:
        score += personality.energy_baseline * 0.5
    
    # Sociable personalities prefer social hubs AND karaoke (social activities)
    if action == ActionType.INTERACT_SOCIAL_HUB:
        score += personality.sociability * 0.8
    if action == ActionType.INTERACT_KARAOKE:
        score += personality.sociability * 0.6  # Karaoke is social!
        score += 0.3  # Base fun bonus
    
    # Food is universally enjoyed
    if action == ActionType.INTERACT_FOOD:
        score += 0.4  # Everyone enjoys eating!
    
    # Curious personalities prefer wander points
    if action == ActionType.INTERACT_WANDER_POINT:
        score += personality.curiosity * 0.7
    
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
            # Positive relationships strongly encourage conversation
            score += social_memory.sentiment * 0.8  # Increased from 0.5
            # Familiarity makes interaction much more comfortable
            score += social_memory.familiarity * 0.5  # Increased from 0.3
            
            # More interactions = stronger desire to continue relationship
            if social_memory.interaction_count > 3:
                score += 0.2  # Increased from 0.1
            if social_memory.interaction_count > 10:
                score += 0.2  # Extra bonus for established relationships
            
            # Mutual interests give a bonus (more to talk about)
            if hasattr(social_memory, 'mutual_interests') and social_memory.mutual_interests:
                interests = social_memory.mutual_interests
                if isinstance(interests, list) and len(interests) > 0:
                    score += min(len(interests) * 0.1, 0.4)  # Increased cap
        
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
        # Unknown avatars get curiosity bonus (want to meet new people!)
        # Meeting strangers is exciting - high bonus for new connections
        if action == ActionType.INITIATE_CONVERSATION:
            score += 0.4  # Increased from 0.15 - agents want to meet new people!
    
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
    
    Agents with high affinity for a location type get a significant bonus,
    making them much more likely to choose activities they enjoy.
    
    Affinity ranges from 0.0 (dislikes) to 1.0 (loves).
    - 0.0-0.3: Dislikes, negative score
    - 0.3-0.5: Neutral, small bonus
    - 0.5-0.7: Likes, moderate bonus
    - 0.7-1.0: Loves, large bonus
    """
    if not location:
        return 0.0
    
    affinity = personality.world_affinities.get(location.location_type.value, 0.5)
    
    if action in [ActionType.WALK_TO_LOCATION, ActionType.INTERACT_FOOD, 
                  ActionType.INTERACT_KARAOKE, ActionType.INTERACT_REST,
                  ActionType.INTERACT_SOCIAL_HUB, ActionType.INTERACT_WANDER_POINT]:
        # Non-linear scaling - high affinity gives much bigger bonus
        if affinity >= 0.7:
            # Loves this activity - strong bonus
            return 0.6 + (affinity - 0.7) * 2.0  # 0.6 to 1.2
        elif affinity >= 0.5:
            # Likes this activity - moderate bonus
            return 0.2 + (affinity - 0.5) * 2.0  # 0.2 to 0.6
        elif affinity >= 0.3:
            # Neutral - small bonus
            return (affinity - 0.3) * 1.0  # 0.0 to 0.2
        else:
            # Dislikes - penalty
            return (affinity - 0.3) * 1.0  # -0.3 to 0.0
    
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
    
    AGENTS ARE SOCIAL ONLY:
    - NO location actions (food, karaoke, rest, etc.) - humans only!
    - Agents only: Talk, Move towards people, Wander to find people
    """
    actions: list[CandidateAction] = []
    
    # Idle is available but heavily penalized
    actions.append(CandidateAction(
        action_type=ActionType.IDLE,
        target=None
    ))
    
    # Always available: Wander (with social-biased target to find people)
    wander_x, wander_y = calculate_social_wander_target(context)
    actions.append(CandidateAction(
        action_type=ActionType.WANDER,
        target=ActionTarget(
            target_type="position",
            x=wander_x,
            y=wander_y
        )
    ))
    
    # =========================================================================
    # DISABLED: World location actions - AGENTS DON'T USE LOCATIONS!
    # These are for human players only.
    # =========================================================================
    # Location actions are completely removed for agents.
    
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
            # If we like them or neutral, consider talking (must be CLOSE - within conversation radius)
            elif nearby.distance <= DecisionConfig.CONVERSATION_RADIUS:
                actions.append(CandidateAction(
                    action_type=ActionType.INITIATE_CONVERSATION,
                    target=ActionTarget(
                        target_type="avatar",
                        target_id=nearby.avatar_id,
                        name=nearby.display_name or f"avatar {nearby.avatar_id[:8]}",
                        x=nearby.x,
                        y=nearby.y
                    )
                ))
            # If they're nearby but not close enough for conversation, consider moving towards them
            elif nearby.distance <= DecisionConfig.SOCIAL_APPROACH_RADIUS:
                # Move towards this avatar for potential conversation
                actions.append(CandidateAction(
                    action_type=ActionType.MOVE,
                    target=ActionTarget(
                        target_type="avatar",
                        target_id=nearby.avatar_id,
                        name=f"towards {nearby.display_name or nearby.avatar_id[:8]}",
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
                (loc for loc in context.world_locations if loc.id == action.target.target_id),
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
    
    BALANCED BEHAVIOR:
    - NO location-based interrupts (humans only)
    - Pending conversation requests trigger JOIN_CONVERSATION for human players
    - For other agents, let the conversation module decide (don't auto-accept here)
    """
    import random
    
    # =========================================================================
    # DISABLED: ALL LOCATION-BASED INTERRUPTS
    # Agents don't use locations (food, rest, karaoke, etc.) - humans only!
    # =========================================================================
    
    # =========================================================================
    # Pending conversation requests from HUMAN PLAYERS - always accept!
    # For ROBOTS, don't auto-accept here - let the conversation module decide
    # =========================================================================
    if context.pending_conversation_requests:
        for request in context.pending_conversation_requests:
            initiator_type = request.get("initiator_type", "ROBOT")
            # Always accept from human players - top priority!
            if initiator_type == "PLAYER":
                return SelectedAction(
                    action_type=ActionType.JOIN_CONVERSATION,
                    target=ActionTarget(
                        target_type="avatar",
                        target_id=request.get("initiator_id")
                    ),
                    utility_score=20.0  # Maximum priority for players!
                )
            # For robots, 70% chance to flag for acceptance (let main logic handle decline)
            elif random.random() < 0.7:
                return SelectedAction(
                    action_type=ActionType.JOIN_CONVERSATION,
                    target=ActionTarget(
                        target_type="avatar",
                        target_id=request.get("initiator_id")
                    ),
                    utility_score=10.0
                )
            # 30% chance: don't return interrupt, let normal decision flow handle it
    
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
    """
    Calculate how long an action should take.
    
    ALWAYS ACTIVE:
    - NO idle or standing still (tiny durations if somehow selected)
    - Conversations are moderate length
    - Movement actions keep agents constantly exploring
    """
    durations = {
        ActionType.IDLE: 0.5,  # TINY - immediately do something else!
        ActionType.WANDER: 8.0,  # Good exploration time
        ActionType.WALK_TO_LOCATION: 5.0,  # Unused - agents don't use locations
        ActionType.INTERACT_FOOD: 3.0,  # Unused - humans only
        ActionType.INTERACT_KARAOKE: 3.0,  # Unused - humans only
        ActionType.INTERACT_REST: 3.0,  # Unused - humans only
        ActionType.INTERACT_SOCIAL_HUB: 3.0,  # Unused - humans only
        ActionType.INTERACT_WANDER_POINT: 3.0,  # Unused - humans only
        ActionType.INITIATE_CONVERSATION: 25.0,  # Moderate conversations
        ActionType.JOIN_CONVERSATION: 25.0,  # Moderate conversations
        ActionType.LEAVE_CONVERSATION: 1.0,  # Quick exit then walk!
        ActionType.MOVE: 6.0,  # Walking time
        ActionType.STAND_STILL: 0.5,  # TINY - immediately move!
    }
    return durations.get(action_type, 5.0)


# ============================================================================
# STATE UPDATES
# ============================================================================

def apply_state_decay(state: AgentState, elapsed_seconds: float) -> AgentState:
    """
    Apply natural decay/growth to agent needs over time.
    Called at the start of each tick.
    
    AGENTS ARE SOCIAL ONLY:
    - Energy: ALWAYS 100% (never tired)
    - Hunger: ALWAYS 0% (never hungry - no food locations)
    - Loneliness: Grows VERY FAST to encourage constant chatting
    - Mood: Stays positive
    """
    # Calculate number of "ticks" worth of decay (normalized to 5 minute intervals)
    tick_factor = elapsed_seconds / 300.0
    
    # DISABLED: Energy and hunger never change
    new_energy = 1.0  # Always full energy!
    new_hunger = 0.0  # Never hungry - agents don't eat!
    
    # Loneliness grows VERY FAST (to encourage agents to seek conversation constantly)
    new_loneliness = min(1.0, state.loneliness + DecisionConfig.LONELINESS_GROWTH * tick_factor)
    
    # Mood stays positive (agents are happy social creatures!)
    new_mood = max(0.3, state.mood * (1.0 - 0.005 * tick_factor))  # Minimum 0.3 mood
    
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
