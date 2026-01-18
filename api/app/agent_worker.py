"""
Agent Worker - Processes agent decisions on-demand

This module implements the decision processing for individual agents.
Agents request their next action when they're free/done with their current action.

TABLE UPDATE FLOW:
==================

When process_agent_tick() is called:

1. BUILD CONTEXT (reads from):
   - user_positions (avatar position, conversation state)
   - agent_personality (static traits)
   - agent_state (dynamic needs)
   - agent_social_memory (relationships)
   - world_locations (available locations)
   - world_interactions (cooldowns)

2. APPLY STATE DECAY (updates):
   - agent_state: energy--, hunger++, loneliness++, mood->neutral
   - ✅ DONE: apply_state_decay() is called before making decision

3. MAKE DECISION (reads context, no writes)

4. EXECUTE ACTION (updates):
   - agent_state: Apply action effects
   - user_positions: Update x, y if moving
   - TODO: world_interactions: Create interaction record for location visits

5. SAVE DECISION (writes):
   - agent_decisions: Audit log of what was decided
   - ⚠️ NOTE: Only saved when debug=True! Consider always logging.

TODO LIST:
- [x] Call apply_state_decay() before decision ✅
- [ ] Call start_location_interaction() when walking to location
- [ ] Call complete_location_interaction() when action expires
- [ ] Always log decisions (not just debug mode)?
- [ ] Update social_memory after conversation ends (handled elsewhere)
"""

import logging
import random
from datetime import datetime, timedelta
from typing import Optional

from .agent_models import (
    AgentContext,
    AgentState,
    SelectedAction,
    ActionType,
    ActionTarget,
    AgentDecisionLog,
)
from .agent_engine import (
    make_decision,
    apply_state_decay,
    apply_interaction_effects,
    generate_candidate_actions,
    score_all_actions,
)
from . import agent_database as agent_db


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============================================================================
# ACTION EXECUTION
# ============================================================================

def execute_action(
    client,
    context: AgentContext,
    action: SelectedAction
) -> tuple[AgentState, str]:
    """
    Execute an action and return the updated state and result.
    
    Returns:
        tuple: (updated_state, result_message)
    """
    state = context.state
    result = "success"
    
    if action.action_type == ActionType.IDLE:
        # Idle recovers a small amount of energy
        state = apply_interaction_effects(state, {"energy": 0.05, "mood": 0.01})
        logger.info(f"Avatar {context.avatar_id} is idling")
    
    elif action.action_type == ActionType.WANDER:
        # Wander costs a bit of energy but improves mood slightly
        state = apply_interaction_effects(state, {"energy": -0.03, "mood": 0.02})
        # Update position towards wander target
        if action.target and action.target.x is not None and action.target.y is not None:
            # Move partially towards target (simulates gradual movement)
            dx = action.target.x - context.x
            dy = action.target.y - context.y
            # Move up to 3 units per tick
            new_x = context.x + max(-3, min(3, dx))
            new_y = context.y + max(-3, min(3, dy))
            agent_db.update_avatar_position(client, context.avatar_id, new_x, new_y)
            logger.info(f"Avatar {context.avatar_id} wandering to ({new_x}, {new_y})")
    
    elif action.action_type == ActionType.WALK_TO_LOCATION:
        if action.target and action.target.target_id:
            # Find the location
            location = next(
                (loc for loc in context.world_locations if loc.id == action.target.target_id),
                None
            )
            if location:
                # Move towards location
                dx = location.x - context.x
                dy = location.y - context.y
                distance = (dx**2 + dy**2) ** 0.5
                
                if distance <= 1:
                    # Arrived at location (touching)! IMMEDIATELY start the activity
                    # This locks the agent at the location for the activity duration
                    interact_action_map = {
                        'food': ActionType.INTERACT_FOOD,
                        'karaoke': ActionType.INTERACT_KARAOKE,
                        'rest_area': ActionType.INTERACT_REST,
                        'social_hub': ActionType.INTERACT_SOCIAL_HUB,
                        'wander_point': ActionType.INTERACT_WANDER_POINT,
                    }
                    interact_action = interact_action_map.get(location.location_type.value, ActionType.IDLE)
                    
                    # Fast activities - 6 seconds base for quick gameplay
                    # Small randomness (+/- 1 second)
                    randomness = random.uniform(-1, 1)
                    chosen_duration = int(6 + randomness)
                    # Minimum 5 seconds, maximum 8 seconds
                    chosen_duration = max(5, min(chosen_duration, 8))
                    
                    # Set the action to interact with the location
                    state.current_action = interact_action.value
                    state.current_action_target = {
                        **(action.target.model_dump() if action.target else {}),
                        "name": location.name
                    }
                    state.action_started_at = datetime.utcnow()
                    state.action_expires_at = datetime.utcnow() + timedelta(seconds=chosen_duration)
                    
                    # Record the interaction (creates cooldown)
                    agent_db.record_world_interaction(client, context.avatar_id, location)
                    
                    # Log prominent activity start
                    short_id = context.avatar_id[:8]
                    activity_emoji = {
                        'interact_food': '🍽️',
                        'interact_rest': '😴',
                        'interact_karaoke': '🎤',
                        'interact_social_hub': '💬',
                        'interact_wander_point': '🧭',
                    }.get(interact_action.value, '📍')
                    print(f"{activity_emoji} {short_id} | ARRIVED & STARTED {interact_action.value.upper()} at '{location.name}' for {chosen_duration}s")
                    result = "arrived_started_activity"
                else:
                    # Move towards location (up to 3 units per tick)
                    move_factor = min(1.0, 3.0 / distance)
                    new_x = context.x + int(dx * move_factor)
                    new_y = context.y + int(dy * move_factor)
                    agent_db.update_avatar_position(client, context.avatar_id, new_x, new_y)
                    state = apply_interaction_effects(state, {"energy": -0.02})
                    logger.info(f"Avatar {context.avatar_id} walking to '{location.name}' [{location.location_type.value}] - distance: {distance:.1f}")
    
    elif action.action_type in [ActionType.INTERACT_FOOD, ActionType.INTERACT_KARAOKE, ActionType.INTERACT_REST, ActionType.INTERACT_SOCIAL_HUB, ActionType.INTERACT_WANDER_POINT]:
        # Agent is already at a location doing an activity
        # Check if the activity should continue or complete
        if action.target and action.target.target_id:
            location = next(
                (loc for loc in context.world_locations if loc.id == action.target.target_id),
                None
            )
            if location:
                # Check if we're continuing an existing activity or starting fresh
                if context.state.action_expires_at:
                    expires_at = context.state.action_expires_at
                    if isinstance(expires_at, str):
                        expires_at = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                    if expires_at.tzinfo:
                        expires_at = expires_at.replace(tzinfo=None)
                    
                    if datetime.utcnow() >= expires_at:
                        # Activity completed! Apply remaining effects
                        state = apply_interaction_effects(state, location.effects)
                        state.current_action = 'idle'
                        state.current_action_target = None
                        state.action_started_at = None
                        state.action_expires_at = None
                        
                        short_id = context.avatar_id[:8]
                        print(f"✅ {short_id} | COMPLETED {action.action_type.value} at {location.name}")
                        print(f"   Stats now: E:{state.energy:.0%} H:{state.hunger:.0%} L:{state.loneliness:.0%} M:{state.mood:.0%}")
                        result = "activity_completed"
                    else:
                        # Still doing the activity - apply gradual effects per tick
                        remaining = (expires_at - datetime.utcnow()).total_seconds()
                        
                        # Get started_at for progress calculation
                        started_at = context.state.action_started_at
                        if isinstance(started_at, str):
                            started_at = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
                        if started_at and started_at.tzinfo:
                            started_at = started_at.replace(tzinfo=None)
                        
                        # Calculate total duration and apply proportional effects per tick
                        if started_at:
                            total_duration = (expires_at - started_at).total_seconds()
                            if total_duration > 0:
                                # Apply a fraction of effects each tick
                                # AI loop runs every ~1 second, so apply 1/total_duration of effects
                                tick_fraction = 1.0 / total_duration
                                partial_effects = {
                                    stat: value * tick_fraction
                                    for stat, value in location.effects.items()
                                }
                                state = apply_interaction_effects(state, partial_effects)
                                short_id = context.avatar_id[:8]
                                logger.debug(f"{short_id} applying partial effects {partial_effects} from {location.name}")
                        
                        logger.info(f"Avatar {context.avatar_id} doing {action.action_type.value} at {location.name} - {remaining:.0f}s remaining")
                        result = "activity_in_progress"
                else:
                    # Starting the activity fresh - fast 6-second activities
                    randomness = random.uniform(-1, 1)
                    chosen_duration = int(6 + randomness)
                    chosen_duration = max(5, min(chosen_duration, 8))
                    
                    state.current_action = action.action_type.value
                    state.current_action_target = {
                        **(action.target.model_dump() if action.target else {}),
                        "name": location.name
                    }
                    state.action_started_at = datetime.utcnow()
                    state.action_expires_at = datetime.utcnow() + timedelta(seconds=chosen_duration)
                    
                    agent_db.record_world_interaction(client, context.avatar_id, location)
                    
                    short_id = context.avatar_id[:8]
                    # Log prominent activity start
                    activity_emoji = {
                        'interact_food': '🍽️',
                        'interact_rest': '😴',
                        'interact_karaoke': '🎤',
                        'interact_social_hub': '💬',
                        'interact_wander_point': '🧭',
                    }.get(action.action_type.value, '📍')
                    print(f"{activity_emoji} {short_id} | STARTED {action.action_type.value.upper()} at '{location.name}' for {chosen_duration}s")
                    result = "arrived_started_activity"
    
    elif action.action_type == ActionType.INITIATE_CONVERSATION:
        if action.target and action.target.target_id:
            # Social interaction reduces loneliness
            state = apply_interaction_effects(state, {"loneliness": -0.2, "energy": -0.05})
            # Update social memory
            agent_db.update_social_memory(
                client,
                context.avatar_id,
                action.target.target_id,
                sentiment_delta=0.05,  # Slight positive sentiment for initiating
                familiarity_delta=0.1
            )
            logger.info(f"Avatar {context.avatar_id} initiated conversation with {action.target.target_id}")
    
    elif action.action_type == ActionType.JOIN_CONVERSATION:
        state = apply_interaction_effects(state, {"loneliness": -0.15, "mood": 0.05})
        logger.info(f"Avatar {context.avatar_id} joined a conversation")
    
    elif action.action_type == ActionType.LEAVE_CONVERSATION:
        logger.info(f"Avatar {context.avatar_id} left the conversation")
    
    elif action.action_type == ActionType.AVOID_AVATAR:
        # Move away from disliked avatar
        if action.target and action.target.x is not None and action.target.y is not None:
            # Move towards flee position
            dx = action.target.x - context.x
            dy = action.target.y - context.y
            distance = max(1, (dx**2 + dy**2) ** 0.5)
            # Move up to 4 units per tick (faster than normal walking)
            move_factor = min(1.0, 4.0 / distance)
            new_x = context.x + int(dx * move_factor)
            new_y = context.y + int(dy * move_factor)
            agent_db.update_avatar_position(client, context.avatar_id, new_x, new_y)
            state = apply_interaction_effects(state, {"energy": -0.03, "mood": -0.05})  # Fleeing is stressful
            target_name = action.target.target_id[:8] if action.target.target_id else "unknown"
            logger.info(f"Avatar {context.avatar_id} avoiding avatar {target_name} - moving to ({new_x}, {new_y})")
    
    # Update the current action in state - but DON'T overwrite if we already set it
    # (e.g., when WALK_TO_LOCATION transitions to INTERACT_*)
    if result not in ["arrived_started_activity", "activity_in_progress", "activity_completed"]:
        # Only update action metadata if it's a NEW action (not continuing an existing one)
        # For walk_to_location: we want to track the action but NOT lock with expires_at
        # Locking is only for activities where the agent should stand still
        is_new_action = state.current_action != action.action_type.value
        is_activity = action.action_type.value.startswith('interact_')
        
        state.current_action = action.action_type.value
        state.current_action_target = action.target.model_dump() if action.target else None
        
        # Only set timestamps for NEW actions, and only set expires_at for activities
        if is_new_action:
            state.action_started_at = datetime.utcnow()
            if is_activity and action.duration_seconds:
                state.action_expires_at = datetime.utcnow() + timedelta(seconds=action.duration_seconds)
            elif not is_activity:
                # For non-activities (walking, wandering), don't set expires - they complete on arrival
                state.action_expires_at = None
    # else: result was "arrived_started_activity" etc. - state was already updated by execute_action
    
    return state, result


# ============================================================================
# AGENT ACTION PROCESSING
# ============================================================================

def process_agent_tick(
    client,
    avatar_id: str,
    debug: bool = False
) -> Optional[dict]:
    """
    Get the next action for an agent (on-demand).
    
    Call this when an agent is free/done with their current action
    to determine what they should do next.
    
    Args:
        client: Supabase client
        avatar_id: The avatar requesting their next action
        debug: If True, log detailed decision info
    
    Returns:
        dict with action info if successful, None if failed
    """
    try:
        # Try to acquire lock
        if not agent_db.acquire_tick_lock(client, avatar_id):
            logger.debug(f"Could not acquire lock for {avatar_id}")
            return None
        
        # Build context
        context = agent_db.build_agent_context(client, avatar_id)
        if not context:
            logger.warning(f"Could not build context for {avatar_id}")
            agent_db.release_tick_lock(client, avatar_id)
            return None
        
        # Calculate elapsed time since last tick
        last_tick = context.state.last_tick
        if last_tick:
            if isinstance(last_tick, str):
                last_tick = datetime.fromisoformat(last_tick.replace('Z', '+00:00'))
            # Make both datetimes naive for comparison
            if last_tick.tzinfo is not None:
                last_tick = last_tick.replace(tzinfo=None)
            elapsed = (datetime.utcnow() - last_tick).total_seconds()
        else:
            elapsed = 300  # Default 5 minutes
        
        # Apply state decay
        context.state = apply_state_decay(context.state, elapsed)
        
        # Check if agent is mid-activity and should continue
        # Don't make a new decision if we're doing an activity or walking somewhere!
        action = None
        
        # Check for ongoing interact activities (rest, food, karaoke, etc.)
        interact_actions = ['interact_rest', 'interact_food', 'interact_karaoke', 'interact_social_hub', 'interact_wander_point']
        if context.state.current_action in interact_actions and context.state.current_action_target:
            target = context.state.current_action_target
            target_id = target.get('target_id')
            if target_id and context.state.action_expires_at:
                # Check if activity is still ongoing
                expires_at = context.state.action_expires_at
                if isinstance(expires_at, str):
                    expires_at = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                if expires_at.tzinfo:
                    expires_at = expires_at.replace(tzinfo=None)
                
                if datetime.utcnow() < expires_at:
                    # Activity still in progress - continue it
                    location = next(
                        (loc for loc in context.world_locations if loc.id == target_id),
                        None
                    )
                    if location:
                        action = SelectedAction(
                            action_type=ActionType(context.state.current_action),
                            target=ActionTarget(
                                target_type="location",
                                target_id=location.id,
                                name=location.name,
                                x=location.x,
                                y=location.y
                            ),
                            utility_score=10.0,  # High score - we're committed
                            duration_seconds=location.duration_seconds
                        )
                        remaining = (expires_at - datetime.utcnow()).total_seconds()
                        short_id = avatar_id[:8]
                        print(f"⏳ {short_id} | CONTINUING {context.state.current_action} at {location.name} - {remaining:.0f}s remaining")
        
        # Check if agent is mid-walk and should continue to destination
        if action is None and context.state.current_action == 'walk_to_location' and context.state.current_action_target:
            target = context.state.current_action_target
            target_id = target.get('target_id')
            if target_id:
                # Find the destination location
                location = next(
                    (loc for loc in context.world_locations if loc.id == target_id),
                    None
                )
                if location:
                    # Check if we've arrived
                    dx = location.x - context.x
                    dy = location.y - context.y
                    distance = (dx**2 + dy**2) ** 0.5
                    
                    if distance > 1:
                        # Still walking - continue to destination
                        action = SelectedAction(
                            action_type=ActionType.WALK_TO_LOCATION,
                            target=ActionTarget(
                                target_type="location",
                                target_id=location.id,
                                name=location.name,
                                x=location.x,
                                y=location.y
                            ),
                            utility_score=5.0,  # High score - we're committed to this
                            duration_seconds=None  # No duration lock for walking
                        )
                        short_id = avatar_id[:8]
                        print(f"🚶 {short_id} | WALKING to '{location.name}' - {distance:.1f} tiles away")
                    else:
                        # We've arrived! Start the activity directly here
                        interact_action_map = {
                            'food': ActionType.INTERACT_FOOD,
                            'karaoke': ActionType.INTERACT_KARAOKE,
                            'rest_area': ActionType.INTERACT_REST,
                            'social_hub': ActionType.INTERACT_SOCIAL_HUB,
                            'wander_point': ActionType.INTERACT_WANDER_POINT,
                        }
                        interact_action = interact_action_map.get(location.location_type.value, ActionType.IDLE)
                        
                        # Create the activity action directly
                        action = SelectedAction(
                            action_type=interact_action,
                            target=ActionTarget(
                                target_type="location",
                                target_id=location.id,
                                name=location.name,
                                x=location.x,
                                y=location.y
                            ),
                            utility_score=10.0,  # High score - doing the activity
                            duration_seconds=location.duration_seconds
                        )
                        short_id = avatar_id[:8]
                        print(f"[Activity] {short_id} started {interact_action.value} at {location.name}")
        
        # Make a new decision if we're not mid-walk
        if action is None:
            action = make_decision(context)
        
        # Execute action
        new_state, result = execute_action(client, context, action)
        
        # Update state in database
        agent_db.update_state(client, new_state)
        
        # Log decision if debug mode
        # NOTE: Decision logging is currently DEBUG-ONLY!
        # TODO: Consider always logging decisions for audit trail
        #       Or make this configurable via environment variable
        if debug:
            candidates = generate_candidate_actions(context)
            scored = score_all_actions(candidates, context)
            
            log = AgentDecisionLog(
                avatar_id=avatar_id,
                tick_timestamp=datetime.utcnow(),
                state_snapshot={
                    "energy": context.state.energy,
                    "hunger": context.state.hunger,
                    "loneliness": context.state.loneliness,
                    "mood": context.state.mood,
                    "x": context.x,
                    "y": context.y,
                },
                available_actions=[
                    {
                        "action": a.action_type.value,
                        "score": a.utility_score,
                        "target": a.target.model_dump() if a.target else None,
                    }
                    for a in scored
                ],
                selected_action={
                    "action": action.action_type.value,
                    "score": action.utility_score,
                    "target": action.target.model_dump() if action.target else None,
                },
                action_result=result,
            )
            agent_db.log_decision(client, log)
        
        # Release lock
        agent_db.release_tick_lock(client, avatar_id)
        
        # Return the ACTUAL current action after execution (may differ from decision)
        # e.g., walk_to_location -> interact_food when agent arrives
        actual_action = new_state.current_action or action.action_type.value
        
        logger.info(f"Processed tick for {avatar_id}: decision={action.action_type.value}, actual={actual_action}")
        
        # Get duration if agent is now doing an activity
        duration_seconds = None
        if new_state.action_expires_at and new_state.action_started_at:
            expires = new_state.action_expires_at
            if isinstance(expires, str):
                expires = datetime.fromisoformat(expires.replace('Z', '+00:00'))
            if hasattr(expires, 'tzinfo') and expires.tzinfo:
                expires = expires.replace(tzinfo=None)
            duration_seconds = (expires - datetime.utcnow()).total_seconds()
            if duration_seconds < 0:
                duration_seconds = None
        
        return {
            "avatar_id": avatar_id,
            "action": actual_action,  # Use the state's current action, not the decision
            "target": new_state.current_action_target or (action.target.model_dump() if action.target else None),
            "score": action.utility_score,
            "duration_seconds": duration_seconds,  # Include remaining duration
            "state": {
                "energy": new_state.energy,
                "hunger": new_state.hunger,
                "loneliness": new_state.loneliness,
                "mood": new_state.mood,
            }
        }
        
    except Exception as e:
        logger.error(f"Error processing action request for {avatar_id}: {e}")
        try:
            agent_db.release_tick_lock(client, avatar_id)
        except:
            pass
        return None
