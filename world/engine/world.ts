// ============================================================================
// WORLD ENGINE - The main API for interacting with the simulation
// ============================================================================

import type { Entity } from '../entities/entity';
import type { MapDef } from '../map/mapDef';
import type { WorldState } from '../state/worldState';
import type { WorldAction, WorldEvent, Result } from '../actions/types';
import { ok, err } from '../actions/types';
import { createWorldState, getAllEntities } from '../state/worldState';
import { createEntity } from '../entities/entity';
import { clampToBounds } from '../map/mapDef';
import { processAction } from '../actions/pipeline';
import { findPath } from '../utils/pathfinding';
import { ReservationTable, resolveMoves, type MoveProposal } from '../utils/reservations';

// ============================================================================
// SNAPSHOT TYPE
// ============================================================================

export interface WorldSnapshot {
  readonly map: MapDef;
  readonly entities: readonly Entity[];
}

// ============================================================================
// WORLD CLASS
// ============================================================================

/**
 * World is the SINGLE SOURCE OF TRUTH for the simulation.
 * 
 * Invariants:
 * - All operations are synchronous
 * - All operations are deterministic
 * - The world never throws - errors are returned as Result
 * - Human and AI actors are treated identically
 */
export class World {
  private state: WorldState;

  constructor(mapDef: MapDef) {
    this.state = createWorldState(mapDef);
  }

  /**
   * Add an entity to the world.
   * Entity position is clamped to map bounds.
   * Returns ENTITY_JOINED event on success.
   */
  addEntity(entity: Entity): Result<WorldEvent[]> {
    // Check for duplicate
    if (this.state.entities.has(entity.entityId)) {
      return err(
        'ENTITY_EXISTS',
        `Entity ${entity.entityId} already exists in the world`
      );
    }

    // Clamp position to map bounds
    const clamped = clampToBounds(this.state.map, entity.x, entity.y);
    const clampedEntity = createEntity(
      entity.entityId,
      entity.kind,
      entity.displayName,
      clamped.x,
      clamped.y,
      entity.color,
      entity.facing
    );

    // Add to state
    this.state.entities.set(clampedEntity.entityId, clampedEntity);

    // Return event
    const event: WorldEvent = {
      type: 'ENTITY_JOINED',
      entity: clampedEntity,
    };

    return ok([event]);
  }

  /**
   * Remove an entity from the world.
   * Returns ENTITY_LEFT event on success.
   */
  removeEntity(entityId: string): Result<WorldEvent[]> {
    // Check existence
    if (!this.state.entities.has(entityId)) {
      return err(
        'ENTITY_NOT_FOUND',
        `Entity ${entityId} does not exist in the world`
      );
    }

    // Remove from state
    this.state.entities.delete(entityId);

    // Return event
    const event: WorldEvent = {
      type: 'ENTITY_LEFT',
      entityId,
    };

    return ok([event]);
  }

  /**
   * Submit an action on behalf of an entity.
   * Actions go through the validation -> apply pipeline.
   * Returns events on success.
   */
  submitAction(entityId: string, action: WorldAction): Result<WorldEvent[]> {
    return processAction(this.state, entityId, action);
  }

  /**
   * Set the AI target for an entity.
   * This is used by external AI controllers (like the Python API bridge).
   */
  setEntityTarget(entityId: string, target: { x: number; y: number } | undefined): void {
    const entity = this.state.entities.get(entityId);
    if (entity) {
      const updated = { 
        ...entity, 
        targetPosition: target,
        targetSetAt: target ? Date.now() : undefined,
        positionHistory: target ? [] : entity.positionHistory,
        stuckCounter: target ? 0 : entity.stuckCounter,
        plannedPath: undefined, // Clear old path, will be replanned
        pathPlanTime: undefined
      };
      this.state.entities.set(entityId, updated);
    }
  }

  /**
   * Advance the world by one tick.
   * Moves entities based on their current direction.
   * Updates AI logic.
   */
  tick(): WorldEvent[] {
    const events: WorldEvent[] = [];
    const entities = getAllEntities(this.state);
    const currentTime = Date.now();
    
    // Build obstacle map for pathfinding
    const obstacles = new Set<string>();
    for (const e of entities) {
      obstacles.add(`${e.x},${e.y}`);
      obstacles.add(`${e.x + 1},${e.y}`);
      obstacles.add(`${e.x},${e.y + 1}`);
      obstacles.add(`${e.x + 1},${e.y + 1}`);
    }

    // Create reservation table for this tick
    const reservations = new ReservationTable();
    const moveProposals: MoveProposal[] = [];

    // Phase 1: Plan paths and collect move proposals
    for (const entity of entities) {
      if (entity.kind === 'WALL') continue;

      // Robot AI: Cached BFS Pathfinding with Reservation Proposals
      if (entity.kind === 'ROBOT') {
        let target = entity.targetPosition;
        let targetSetAt = entity.targetSetAt;
        let positionHistory = entity.positionHistory || [];
        let stuckCounter = entity.stuckCounter || 0;
        let plannedPath = entity.plannedPath;
        let lastMovedTime = entity.lastMovedTime || currentTime;
        
        const currentPos = `${entity.x},${entity.y}`;
        const NO_PROGRESS_TIMEOUT_MS = 5000; // 4 seconds without movement
        const REPLAN_INTERVAL = 5; // Replan every 5 ticks
        const HISTORY_SIZE = 10; // Track last 10 positions
        const STUCK_THRESHOLD = 5; // If we see same position 5 times in history, we're stuck
        
        // Check if robot has made progress recently
        const lastPos = positionHistory.length > 0 ? positionHistory[0] : null;
        const hasMoved = lastPos !== currentPos;
        
        if (hasMoved) {
          // Robot moved - update last moved time
          lastMovedTime = currentTime;
        }
        
        // Check for timeout (robot hasn't moved toward target for too long)
        if (target && lastMovedTime && (currentTime - lastMovedTime > NO_PROGRESS_TIMEOUT_MS)) {
          // Timeout - give up on this target (robot is stuck/blocked)
          target = undefined;
          targetSetAt = undefined;
          positionHistory = [];
          stuckCounter = 0;
          plannedPath = undefined;
          lastMovedTime = currentTime;
        }
        
        // Update position history
        positionHistory = [currentPos, ...positionHistory].slice(0, HISTORY_SIZE);
        
        // Detect if stuck (same position appears too many times in recent history)
        const positionCounts = positionHistory.reduce((acc, pos) => {
          acc[pos] = (acc[pos] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        const isStuckInLoop = Object.values(positionCounts).some(count => count >= STUCK_THRESHOLD);
        
        if (isStuckInLoop) {
          stuckCounter++;
          // Clear path to force replan
          plannedPath = undefined;
        } else {
          // Reset stuck counter if we're making progress
          stuckCounter = 0;
        }

        // Cached BFS pathfinding with path caching
        if (target) {
          // Check if we need to replan
          const needsReplan = !plannedPath || 
                              plannedPath.length === 0 || 
                              (entity.pathPlanTime && (currentTime - entity.pathPlanTime) > REPLAN_INTERVAL * 100);
          
          if (needsReplan) {
            // Replan path using BFS
            const selfCells = [
              `${entity.x},${entity.y}`,
              `${entity.x + 1},${entity.y}`,
              `${entity.x},${entity.y + 1}`,
              `${entity.x + 1},${entity.y + 1}`
            ];
            const pathObstacles = new Set(obstacles);
            selfCells.forEach(c => pathObstacles.delete(c));
            
            plannedPath = findPath(this.state.map, { x: entity.x, y: entity.y }, target, pathObstacles) || undefined;
          }
          
          if (plannedPath && plannedPath.length > 0) {
            // Check if we've reached the target
            const nextStep = plannedPath[0];
            if (nextStep.x === entity.x && nextStep.y === entity.y) {
              // Remove current position from path
              plannedPath = plannedPath.slice(1);
            }
            
            if (plannedPath.length === 0) {
              // At target - clear it so AI can assign new target
              target = undefined;
              targetSetAt = undefined;
              positionHistory = [];
              stuckCounter = 0;
              plannedPath = undefined;
            } else {
              // Propose next move from path
              const next = plannedPath[0];
              const dx = next.x - entity.x;
              const dy = next.y - entity.y;
              
              if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
                // Valid next step - create move proposal
                const priority = stuckCounter >= 5 ? 100 : Math.abs(target.x - entity.x) + Math.abs(target.y - entity.y);
                moveProposals.push({
                  entityId: entity.entityId,
                  from: { x: entity.x, y: entity.y },
                  to: next,
                  priority
                });
              } else {
                // Path is invalid, replan next tick
                plannedPath = undefined;
              }
            }
          }
        }
        // Store updated state for this robot
        const currentEntity = this.state.entities.get(entity.entityId)!;
        const updatedRobot = { 
          ...currentEntity, 
          targetPosition: target, 
          targetSetAt,
          positionHistory,
          stuckCounter: Math.min(stuckCounter, 10),
          plannedPath,
          pathPlanTime: currentTime,
          lastMovedTime
        };
        this.state.entities.set(entity.entityId, updatedRobot);
      }
    }

    // Phase 2: Resolve move proposals using reservation table
    const approvedMoves = resolveMoves(moveProposals, reservations, currentTime);

    // Phase 3: Execute approved moves and handle rejections
    for (const entity of entities) {
      if (entity.kind === 'WALL') continue;

      if (entity.kind === 'ROBOT') {
        const currentEntity = this.state.entities.get(entity.entityId)!;
        let nextDir = { x: 0 as 0|1|-1, y: 0 as 0|1|-1 };
        let useUnstuckMovement = false;
        
        const approvedMove = approvedMoves.get(entity.entityId);
        
        if (approvedMove !== undefined) {
          if (approvedMove === null) {
            // Move was rejected or wait - try unstuck if stuck counter high
            if (currentEntity.stuckCounter && currentEntity.stuckCounter >= 5) {
              useUnstuckMovement = true;
            }
          } else {
            // Move approved - execute it
            const dx = approvedMove.x - entity.x;
            const dy = approvedMove.y - entity.y;
            nextDir = { x: dx as 0|1|-1, y: dy as 0|1|-1 };
          }
        }
        
        // Unstuck algorithm: try random valid movements to escape deadlock
        if (useUnstuckMovement && currentEntity.targetPosition) {
          const positionHistory = currentEntity.positionHistory || [];
          const directions: Array<{ x: 0|1|-1, y: 0|1|-1 }> = [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 },
          ];
          
          const recentPositions = new Set(positionHistory.slice(0, 3));
          const validDirections = directions.filter(dir => {
            const newX = entity.x + dir.x;
            const newY = entity.y + dir.y;
            const newPos = `${newX},${newY}`;
            
            if (newX < 0 || newY < 0 || newX >= this.state.map.width || newY >= this.state.map.height) {
              return false;
            }
            
            if (recentPositions.has(newPos)) {
              return false;
            }
            
            return true;
          });
          
          if (validDirections.length > 0) {
            const randomDir = validDirections[Math.floor(Math.random() * validDirections.length)];
            nextDir = randomDir;
          } else if (directions.length > 0) {
            const randomDir = directions[Math.floor(Math.random() * directions.length)];
            nextDir = randomDir;
          }
        }

        // Update direction and facing
        const newFacing = (nextDir.x !== 0 || nextDir.y !== 0) ? nextDir : entity.facing;
        const updatedRobot = { 
          ...currentEntity,
          direction: nextDir, 
          facing: newFacing 
        };
        this.state.entities.set(entity.entityId, updatedRobot);

        // If robot turned, emit event
        if (entity.facing && (entity.facing.x !== newFacing!.x || entity.facing.y !== newFacing!.y)) {
          events.push({
            type: 'ENTITY_TURNED',
            entityId: entity.entityId,
            facing: newFacing!
          });
        }
      }

      // Movement Processing (for both Players and Robots)
      const currentEntity = this.state.entities.get(entity.entityId)!;
      
      if (currentEntity.direction && (currentEntity.direction.x !== 0 || currentEntity.direction.y !== 0)) {
        const targetX = currentEntity.x + currentEntity.direction.x;
        const targetY = currentEntity.y + currentEntity.direction.y;
        
        const result = this.submitAction(currentEntity.entityId, {
          type: 'MOVE',
          x: targetX,
          y: targetY
        });

        if (result.ok) {
          events.push(...result.value);
        } else {
          // If blocked, stop.
          // For robot, this will trigger "pick new target" logic next tick implicitly (if we clear target?)
          // But "targetPosition" is still set. The pathfinder will try to find a path around it next tick.
          // Unless the obstacle is the target itself (unlikely for walls).
        }
      }
    }

    return events;
  }

  /**
   * Get a snapshot of the current world state.
   * This is a read-only view suitable for serialization.
   */
  getSnapshot(): WorldSnapshot {
    return {
      map: this.state.map,
      entities: getAllEntities(this.state),
    };
  }

  /**
   * Get a specific entity by ID.
   * Returns undefined if not found.
   */
  getEntity(entityId: string): Entity | undefined {
    return this.state.entities.get(entityId);
  }
}
