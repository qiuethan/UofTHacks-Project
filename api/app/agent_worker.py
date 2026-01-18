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
                (l for l in context.world_locations if l.id == action.target.target_id),
                None
            )
            if location:
                # Move towards location
                dx = location.x - context.x
                dy = location.y - context.y
                distance = (dx**2 + dy**2) ** 0.5
                
                if distance <= 2:
                    # Arrived - execute interaction
                    state = apply_interaction_effects(state, location.effects)
                    agent_db.record_world_interaction(client, context.avatar_id, location)
                    logger.info(f"Avatar {context.avatar_id} interacted with {location.name}")
                else:
                    # Move towards location (up to 3 units per tick)
                    move_factor = min(1.0, 3.0 / distance)
                    new_x = context.x + int(dx * move_factor)
                    new_y = context.y + int(dy * move_factor)
                    agent_db.update_avatar_position(client, context.avatar_id, new_x, new_y)
                    logger.info(f"Avatar {context.avatar_id} walking to '{location.name}' [{location.location_type}] at ({location.x}, {location.y}) - now at ({new_x}, {new_y})")
                    state = apply_interaction_effects(state, {"energy": -0.02})
                    logger.info(f"Avatar {context.avatar_id} walking to {location.name} ({new_x}, {new_y})")
    
    elif action.action_type in [ActionType.INTERACT_FOOD, ActionType.INTERACT_KARAOKE, ActionType.INTERACT_REST]:
        if action.target and action.target.target_id:
            location = next(
                (l for l in context.world_locations if l.id == action.target.target_id),
                None
            )
            if location:
                state = apply_interaction_effects(state, location.effects)
                agent_db.record_world_interaction(client, context.avatar_id, location)
                logger.info(f"Avatar {context.avatar_id} performed {action.action_type.value} at {location.name}")
    
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
    
    # Update the current action in state
    state.current_action = action.action_type.value
    state.current_action_target = action.target.model_dump() if action.target else None
    state.action_started_at = datetime.utcnow()
    if action.duration_seconds:
        state.action_expires_at = datetime.utcnow() + timedelta(seconds=action.duration_seconds)
    
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
        
        # Make decision
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
        
        logger.info(f"Processed tick for {avatar_id}: {action.action_type.value}")
        
        return {
            "avatar_id": avatar_id,
            "action": action.action_type.value,
            "target": action.target.model_dump() if action.target else None,
            "score": action.utility_score,
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
