// ============================================================================
// ACTION PIPELINE - All actions (human or AI) go through this pipeline
// ============================================================================

import type { WorldState } from '../state/worldState';
import type { Avatar } from '../entities/avatar';
import type { WorldAction, WorldEvent, Result } from './types';
import { ok, err } from './types';
import { clampToBounds } from '../map/mapDef';

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate an action before applying it.
 * Returns error result if validation fails.
 * 
 * Invariants:
 * - Actor must exist in the world
 * - MOVE: x and y must be finite numbers
 */
export function validateAction(
  state: WorldState,
  actorId: string,
  action: WorldAction
): Result<void> {
  // Actor must exist
  const actor = state.entities.get(actorId);
  if (!actor) {
    return err('ACTOR_NOT_FOUND', `Entity ${actorId} does not exist in the world`);
  }

  switch (action.type) {
    case 'MOVE':
      return validateMoveAction(action.x, action.y);
  }
}

function validateMoveAction(x: number, y: number): Result<void> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return err('INVALID_COORDINATES', 'x and y must be finite numbers');
  }
  // TODO: Add speed limit validation (max distance per action)
  // TODO: Add rate limiting (actions per second)
  return ok(undefined);
}

// ============================================================================
// APPLICATION
// ============================================================================

/**
 * Apply a validated action to the world state.
 * Mutates state and returns events.
 * 
 * INVARIANT: This function assumes validation has already passed.
 * Always call validateAction first.
 */
export function applyAction(
  state: WorldState,
  actorId: string,
  action: WorldAction
): WorldEvent[] {
  const actor = state.entities.get(actorId)!; // Safe: validated

  switch (action.type) {
    case 'MOVE':
      return applyMoveAction(state, actor, action.x, action.y);
  }
}

function applyMoveAction(
  state: WorldState,
  actor: Avatar,
  targetX: number,
  targetY: number
): WorldEvent[] {
  // Clamp to map bounds
  const clamped = clampToBounds(state.map, targetX, targetY);
  
  // TODO: Add collision detection - check if target tile is blocked
  // TODO: Add proximity/interest management - only notify nearby entities

  // Update entity position (immutable update via Map.set)
  const updatedAvatar: Avatar = {
    ...actor,
    x: clamped.x,
    y: clamped.y,
  };
  state.entities.set(actor.entityId, updatedAvatar);

  return [
    {
      type: 'ENTITY_MOVED',
      entityId: actor.entityId,
      x: clamped.x,
      y: clamped.y,
    },
  ];
}

// ============================================================================
// UNIFIED PIPELINE ENTRY POINT
// ============================================================================

/**
 * Process an action through the full pipeline: validate -> apply -> return events.
 * This is the ONLY way actions should be processed.
 */
export function processAction(
  state: WorldState,
  actorId: string,
  action: WorldAction
): Result<WorldEvent[]> {
  // Step 1: Validate
  const validationResult = validateAction(state, actorId, action);
  if (!validationResult.ok) {
    return validationResult;
  }

  // Step 2: Apply and get events
  const events = applyAction(state, actorId, action);

  // Step 3: Return events
  return ok(events);
}
