// ============================================================================
// ACTION PIPELINE - All actions (human or AI) go through this pipeline
// ============================================================================

import type { WorldState } from '../state/worldState';
import type { Entity } from '../entities/entity';
import type { WorldAction, WorldEvent, Result } from './types';
import { ok, err } from './types';
import { clampToBounds, isTileBlocked, DISABLE_WALL_COLLISIONS } from '../map/mapDef';

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
      if (actor.conversationState === 'IN_CONVERSATION') {
        return err('IN_CONVERSATION', 'Cannot move while in a conversation');
      }
      return validateMoveAction(action.x, action.y);
    case 'SET_DIRECTION':
      if (actor.conversationState === 'IN_CONVERSATION' || actor.conversationState === 'WALKING_TO_CONVERSATION') {
        return err('IN_CONVERSATION', 'Cannot change direction while in a conversation or walking to one');
      }
      return ok(undefined);
    case 'STAND_STILL':
      return ok(undefined);
    case 'REQUEST_CONVERSATION':
      return validateRequestConversation(state, actor, action.targetEntityId);
    case 'ACCEPT_CONVERSATION':
    case 'REJECT_CONVERSATION':
      return ok(undefined); // Request validation handled in World class
    case 'END_CONVERSATION':
      return ok(undefined);
  }
}

function validateRequestConversation(
  state: WorldState,
  actor: Entity,
  targetEntityId: string
): Result<void> {
  const target = state.entities.get(targetEntityId);
  if (!target) {
    return err('TARGET_NOT_FOUND', `Target entity ${targetEntityId} does not exist`);
  }
  if (target.entityId === actor.entityId) {
    return err('INVALID_TARGET', 'Cannot request conversation with self');
  }
  if (target.kind === 'WALL') {
    return err('INVALID_TARGET', 'Cannot request conversation with a wall');
  }
  return ok(undefined);
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
    case 'STAND_STILL':
      return applyStandStill(state, actor);
    case 'REQUEST_CONVERSATION':
    case 'ACCEPT_CONVERSATION':
    case 'REJECT_CONVERSATION':
    case 'END_CONVERSATION':
      // These are handled in World class, not here
      return [];
  }
}

function applyStandStill(
  state: WorldState,
  actor: Entity
): WorldEvent[] {
  // Stop movement by setting direction to 0,0
  const updatedActor: Entity = {
    ...actor,
    direction: { x: 0, y: 0 }
  };
  state.entities.set(actor.entityId, updatedActor);
  return [];
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
  // Determine entity hitbox dimensions based on type
  // All entities are 1x1
  const actorWidth = 1;
  const actorHeight = 1;
  
  // Clamp to map bounds based on entity size
  const maxX = state.map.width - actorWidth;
  const maxY = state.map.height - actorHeight;
  
  const safeX = Math.max(0, Math.min(targetX, maxX));
  const safeY = Math.max(0, Math.min(targetY, maxY));
  
  // Static map collision - check all tiles the entity would occupy
  for (let dx = 0; dx < actorWidth; dx++) {
    for (let dy = 0; dy < actorHeight; dy++) {
      if (isTileBlocked(state.map, safeX + dx, safeY + dy)) {
        return []; // Blocked by static obstacle
      }
    }
  }
  
  // Dynamic entity collision - handle different entity sizes
  for (const other of state.entities.values()) {
    if (other.entityId !== actor.entityId) {
       // TEMPORARY: Skip WALL entity collisions when disabled
       if (DISABLE_WALL_COLLISIONS && other.kind === 'WALL') {
         continue;
       }
       
       const otherWidth = other.kind === 'WALL' ? 1 : 2;
       const otherHeight = 1;  // All entities have height 1 for collision
       
       // Check overlap using AABB collision
       // Actor occupies [safeX, safeX + actorWidth) x [safeY, safeY + actorHeight)
       // Other occupies [other.x, other.x + otherWidth) x [other.y, other.y + otherHeight)
       const overlapX = safeX < other.x + otherWidth && safeX + actorWidth > other.x;
       const overlapY = safeY < other.y + otherHeight && safeY + actorHeight > other.y;
       
       if (overlapX && overlapY) {
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
