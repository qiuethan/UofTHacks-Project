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
      const updated = { ...entity, targetPosition: target };
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
    
    // Build obstacle map for pathfinding
    const obstacles = new Set<string>();
    for (const e of entities) {
      // Assuming all non-PLAYER/ROBOT entities are 2x2 obstacles for pathfinding
      if (e.kind === 'WALL') {
        // A 2x2 entity at (x,y) occupies (x,y), (x+1,y), (x,y+1), (x+1,y+1)
        obstacles.add(`${e.x},${e.y}`);
        obstacles.add(`${e.x + 1},${e.y}`);
        obstacles.add(`${e.x},${e.y + 1}`);
        obstacles.add(`${e.x + 1},${e.y + 1}`);
      }
    }

    for (const entity of entities) {
      if (entity.kind === 'WALL') continue;

      // Robot AI: Pathfinding
      if (entity.kind === 'ROBOT') {
        let target = entity.targetPosition;
        
        // AI Logic would go here to set 'target'
        // For now, robots only move if targetPosition is explicitly set externally

        // Calculate path
        let nextDir = { x: 0 as 0|1|-1, y: 0 as 0|1|-1 };
        if (target) {
          const path = findPath(this.state.map, { x: entity.x, y: entity.y }, target, obstacles);
          if (path && path.length > 0) {
            const nextStep = path[0];
            const dx = nextStep.x - entity.x;
            const dy = nextStep.y - entity.y;
            // Ensure valid direction (should be, as BFS moves 1 step)
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
              nextDir = { x: dx as 0|1|-1, y: dy as 0|1|-1 };
            }
          } else {
             // No path found (trapped?), clear target to try again next tick
             target = undefined;
          }
        }

        // Update state directly for AI "thinking"
        const newFacing = (nextDir.x !== 0 || nextDir.y !== 0) ? nextDir : entity.facing;
        const updatedRobot = { ...entity, targetPosition: target, direction: nextDir, facing: newFacing };
        this.state.entities.set(entity.entityId, updatedRobot);

        // If robot turned, emit event immediately so client sees it even if move is blocked
        if (entity.facing && (entity.facing.x !== newFacing!.x || entity.facing.y !== newFacing!.y)) {
           events.push({
             type: 'ENTITY_TURNED',
             entityId: entity.entityId,
             facing: newFacing!
           });
        }
      }

      // Movement Processing (for both Players and Robots)
      // Re-fetch entity in case it was updated by AI block above
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
