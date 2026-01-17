// ============================================================================
// ACTION PIPELINE - All actions (human or AI) go through this pipeline
// ============================================================================

import type { WorldState } from '../state/worldState';
import type { Entity } from '../entities/entity';
import type { WorldAction, WorldEvent, Result } from './types';
import { ok, err } from './types';
import { clampToBounds } from '../map/mapDef';

// ============================================================================
// VALIDATION
// ============================================================================

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
    case 'SET_DIRECTION':
      return ok(undefined); // Direction is always valid as long as it fits the type (checked by TS)
  }
}

function validateMoveAction(x: number, y: number): Result<void> {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return err('INVALID_COORDINATES', 'x and y must be finite numbers');
  }
  return ok(undefined);
}

// ============================================================================
// APPLICATION
// ============================================================================

export function applyAction(
  state: WorldState,
  actorId: string,
  action: WorldAction
): WorldEvent[] {
  const actor = state.entities.get(actorId)!; // Safe: validated

  switch (action.type) {
    case 'MOVE':
      return applyMoveAction(state, actor, action.x, action.y);
    case 'SET_DIRECTION':
      return applySetDirection(state, actor, action.dx, action.dy);
  }
}

function applySetDirection(
  state: WorldState,
  actor: Entity,
  dx: 0 | 1 | -1,
  dy: 0 | 1 | -1
): WorldEvent[] {
  const updatedActor: Entity = {
    ...actor,
    direction: { x: dx, y: dy }
  };
  state.entities.set(actor.entityId, updatedActor);
  
  // We don't necessarily need to emit an event for direction change unless we want to show it on client
  // For now, let's just update state silently until they move?
  // Actually, client prediction might benefit from knowing direction.
  // But strict requirement was "tick speed". Movement happens on tick.
  return []; 
}

function applyMoveAction(
  state: WorldState,
  actor: Entity,
  targetX: number,
  targetY: number
): WorldEvent[] {
  // Clamp to map bounds
  const clamped = clampToBounds(state.map, targetX, targetY);
  
  // Collision Detection
  for (const other of state.entities.values()) {
    if (other.entityId !== actor.entityId && other.x === clamped.x && other.y === clamped.y) {
      if (other.kind === 'WALL') {
        // Blocked by wall - do nothing
        return [];
      }
      // Optional: Blocked by other players? For now, allow overlapping players/robots, but block walls.
    }
  }

  // Update entity position (immutable update via Map.set)
  const updatedAvatar: Entity = {
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

export function processAction(
  state: WorldState,
  actorId: string,
  action: WorldAction
): Result<WorldEvent[]> {
  const validationResult = validateAction(state, actorId, action);
  if (!validationResult.ok) {
    return validationResult;
  }
  return ok(applyAction(state, actorId, action));
}
