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
  // Enforce single-axis movement (no diagonals)
  // If both are set, prioritize the one that matches the current facing? Or just X?
  // Let's strictly allow only one non-zero component.
  let finalDx = dx;
  let finalDy = dy;
  
  if (dx !== 0 && dy !== 0) {
     // If diagonal attempted, just take X (arbitrary choice for safety)
     finalDy = 0;
  }

  // Only update facing if there is movement intent
  const newFacing = (finalDx !== 0 || finalDy !== 0) ? { x: finalDx, y: finalDy } : actor.facing;

  const updatedActor: Entity = {
    ...actor,
    direction: { x: finalDx, y: finalDy },
    facing: newFacing
  };
  state.entities.set(actor.entityId, updatedActor);
  
  // DEBUG LOGS START
    // DEBUG LOGS END
  
  // Emit turn event if facing changed
  if (actor.facing && (actor.facing.x !== newFacing!.x || actor.facing.y !== newFacing!.y)) {
    return [{
      type: 'ENTITY_TURNED',
      entityId: actor.entityId,
      facing: newFacing!
    }];
  } else if (!actor.facing && newFacing) {
     return [{
      type: 'ENTITY_TURNED',
      entityId: actor.entityId,
      facing: newFacing
    }];
  }

  return []; 
}

function applyMoveAction(
  state: WorldState,
  actor: Entity,
  targetX: number,
  targetY: number
): WorldEvent[] {
  // Clamp to map bounds
  // Entity is 2x2, so it occupies (x,y), (x+1,y), (x,y+1), (x+1,y+1)
  // Max x is width - 2 (so x+1 is width-1)
  // Max y is height - 2
  // But wait, our clampToBound might effectively restrict it to 0..width-1.
  // We need to ensure we don't go out of bounds with the "tail" of the 2x2.
  // Let's rely on clampToBounds but maybe check valid range manually for the 2x2 nature?
  // Actually, simplest is to treat x,y as top-left.
  
  // Custom clamp for 2x2 entity
  const maxX = state.map.width - 2;
  const maxY = state.map.height - 2;
  
  const safeX = Math.max(0, Math.min(targetX, maxX));
  const safeY = Math.max(0, Math.min(targetY, maxY));
  
  // Collision Detection (2x2 vs 2x2)
  for (const other of state.entities.values()) {
    if (other.entityId !== actor.entityId) {
       // Check overlap
       // Overlap if: abs(ax - bx) * 2 < (widthA + widthB)
       // Here width = 2 for both.
       // So: abs(ax - bx) < 2 AND abs(ay - by) < 2
       
       if (Math.abs(safeX - other.x) < 2 && Math.abs(safeY - other.y) < 2) {
         // Block collision with all entity types (WALL, PLAYER, ROBOT)
         return [];
       }
    }
  }

  // Update entity position (immutable update via Map.set)
  const updatedAvatar: Entity = {
    ...actor,
    x: safeX,
    y: safeY,
    // Preserve facing/direction
  };
  state.entities.set(actor.entityId, updatedAvatar);

  return [
    {
      type: 'ENTITY_MOVED',
      entityId: actor.entityId,
      x: safeX,
      y: safeY,
      facing: actor.facing
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
