// Entity Movement Processing Module
// Handles pathfinding state management and movement proposal generation

import type { Entity } from '../entities/entity';
import type { MapDef } from '../map/mapDef';
import type { WorldEvent } from '../actions/types';
import { findPath } from '../utils/pathfinding';
import type { MoveProposal } from '../utils/reservations';

// Pathfinding configuration constants
export const PATHFINDING_CONFIG = {
  NO_PROGRESS_TIMEOUT_MS: 5000,
  REPLAN_INTERVAL: 5,
  HISTORY_SIZE: 10,
  STUCK_THRESHOLD: 5
};

interface PathfindingState {
  target: { x: number; y: number } | undefined;
  targetSetAt: number | undefined;
  positionHistory: string[];
  stuckCounter: number;
  plannedPath: { x: number; y: number }[] | undefined;
  lastMovedTime: number;
}

/**
 * Detects if an entity is stuck in a loop based on position history
 */
function isStuckInLoop(positionHistory: string[]): boolean {
  const positionCounts = positionHistory.reduce((acc, pos) => {
    acc[pos] = (acc[pos] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  return Object.values(positionCounts).some(count => count >= PATHFINDING_CONFIG.STUCK_THRESHOLD);
}

/**
 * Detects if an entity is oscillating between two positions
 */
function isOscillating(positionHistory: string[]): boolean {
  if (positionHistory.length < 6) return false;
  
  const pos0 = positionHistory[0];
  const pos1 = positionHistory[1];
  
  if (pos0 === pos1) return false;
  
  return (
    positionHistory[2] === pos0 &&
    positionHistory[3] === pos1 &&
    positionHistory[4] === pos0 &&
    positionHistory[5] === pos1
  );
}

/**
 * Builds obstacle set from entity positions
 * All entities are 1x1
 */
export function buildObstacleMap(entities: Entity[]): Set<string> {
  const obstacles = new Set<string>();
  for (const e of entities) {
    // All entities are 1x1
    obstacles.add(`${e.x},${e.y}`);
  }
  return obstacles;
}

/**
 * Gets cells occupied by a 1x1 entity
 */
function getEntityCells(x: number, y: number): string[] {
  return [`${x},${y}`];
}

/**
 * Calculates facing direction toward a target position
 */
export function calculateFacingDirection(
  fromX: number, 
  fromY: number, 
  toX: number, 
  toY: number
): { x: 0 | 1 | -1; y: 0 | 1 | -1 } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  return {
    x: (dx > 0 ? 1 : dx < 0 ? -1 : 0) as 0 | 1 | -1,
    y: (dy > 0 ? 1 : dy < 0 ? -1 : 0) as 0 | 1 | -1
  };
}

export interface PathfindingResult {
  updatedEntity: Entity;
  moveProposal: MoveProposal | null;
  reachedTarget: boolean;
}

/**
 * Processes pathfinding for a single entity with a target position.
 * Returns the updated entity state and any move proposal.
 */
export function processEntityPathfinding(
  entity: Entity,
  map: MapDef,
  obstacles: Set<string>,
  currentTime: number,
  getConversationPartner: (id: string) => Entity | undefined
): PathfindingResult {
  // Initialize pathfinding state from entity
  let state: PathfindingState = {
    target: entity.targetPosition,
    targetSetAt: entity.targetSetAt,
    positionHistory: entity.positionHistory || [],
    stuckCounter: entity.stuckCounter || 0,
    plannedPath: entity.plannedPath,
    lastMovedTime: entity.lastMovedTime || currentTime
  };

  const currentPos = `${entity.x},${entity.y}`;
  let moveProposal: MoveProposal | null = null;
  let reachedTarget = false;
  let updatedEntity = { ...entity };

  // Check if entity has moved
  const lastPos = state.positionHistory.length > 0 ? state.positionHistory[0] : null;
  const hasMoved = lastPos !== currentPos;
  
  if (hasMoved) {
    state.lastMovedTime = currentTime;
  }
  
  // Check for timeout
  if (state.target && (currentTime - state.lastMovedTime > PATHFINDING_CONFIG.NO_PROGRESS_TIMEOUT_MS)) {
    state.target = undefined;
    state.targetSetAt = undefined;
    state.positionHistory = [];
    state.stuckCounter = 0;
    state.plannedPath = undefined;
    state.lastMovedTime = currentTime;
  }
  
  // Update position history
  state.positionHistory = [currentPos, ...state.positionHistory].slice(0, PATHFINDING_CONFIG.HISTORY_SIZE);
  
  // Detect stuck/oscillation
  if (isStuckInLoop(state.positionHistory) || isOscillating(state.positionHistory)) {
    state.stuckCounter++;
    state.plannedPath = undefined;
  } else {
    state.stuckCounter = 0;
  }

  // Process pathfinding if we have a target
  if (state.target) {
    // Check if replan needed
    const needsReplan = !state.plannedPath || 
                        state.plannedPath.length === 0 || 
                        (entity.pathPlanTime && (currentTime - entity.pathPlanTime) > PATHFINDING_CONFIG.REPLAN_INTERVAL * 100);
    
    if (needsReplan) {
      // Build obstacles excluding self and target
      const pathObstacles = new Set(obstacles);
      getEntityCells(entity.x, entity.y).forEach(c => pathObstacles.delete(c));
      getEntityCells(state.target!.x, state.target!.y).forEach(c => pathObstacles.delete(c));
      
      state.plannedPath = findPath(map, { x: entity.x, y: entity.y }, state.target, pathObstacles) || undefined;
      updatedEntity.pathPlanTime = currentTime;
    }
    
    if (state.plannedPath && state.plannedPath.length > 0) {
      // Remove current position if at start of path
      const nextStep = state.plannedPath[0];
      if (nextStep.x === entity.x && nextStep.y === entity.y) {
        state.plannedPath = state.plannedPath.slice(1);
      }
      
      if (state.plannedPath.length === 0) {
        // Reached target
        reachedTarget = true;
        
        // Face conversation partner if applicable
        if (entity.conversationState === 'WALKING_TO_CONVERSATION' && entity.conversationTargetId) {
          const partner = getConversationPartner(entity.conversationTargetId);
          if (partner) {
            updatedEntity.facing = calculateFacingDirection(entity.x, entity.y, partner.x, partner.y);
          }
        }
        
        state.target = undefined;
        state.targetSetAt = undefined;
        state.positionHistory = [];
        state.stuckCounter = 0;
        state.plannedPath = undefined;
      } else {
        // Generate move proposal
        const next = state.plannedPath[0];
        const dx = next.x - entity.x;
        const dy = next.y - entity.y;
        
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
          const priority = state.stuckCounter >= 5 ? 100 : Math.abs(state.target!.x - entity.x) + Math.abs(state.target!.y - entity.y);
          moveProposal = {
            entityId: entity.entityId,
            from: { x: entity.x, y: entity.y },
            to: next,
            priority
          };
        } else {
          state.plannedPath = undefined;
        }
      }
    }
  }

  // Update entity with new pathfinding state
  updatedEntity = {
    ...updatedEntity,
    targetPosition: state.target,
    targetSetAt: state.targetSetAt,
    positionHistory: state.positionHistory,
    stuckCounter: state.stuckCounter,
    plannedPath: state.plannedPath,
    lastMovedTime: state.lastMovedTime
  };

  return { updatedEntity, moveProposal, reachedTarget };
}
