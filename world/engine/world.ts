// ============================================================================
// WORLD ENGINE - The main API for interacting with the simulation
// ============================================================================

import type { Avatar } from '../entities/avatar';
import type { MapDef } from '../map/mapDef';
import type { WorldState } from '../state/worldState';
import type { WorldAction, WorldEvent, Result } from '../actions/types';
import { ok, err } from '../actions/types';
import { createWorldState, getAllEntities } from '../state/worldState';
import { createAvatar } from '../entities/avatar';
import { clampToBounds } from '../map/mapDef';
import { processAction } from '../actions/pipeline';

// ============================================================================
// SNAPSHOT TYPE
// ============================================================================

export interface WorldSnapshot {
  readonly map: MapDef;
  readonly entities: readonly Avatar[];
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
  addEntity(avatar: Avatar): Result<WorldEvent[]> {
    // Check for duplicate
    if (this.state.entities.has(avatar.entityId)) {
      return err(
        'ENTITY_EXISTS',
        `Entity ${avatar.entityId} already exists in the world`
      );
    }

    // Clamp position to map bounds
    const clamped = clampToBounds(this.state.map, avatar.x, avatar.y);
    const clampedAvatar = createAvatar(
      avatar.entityId,
      avatar.displayName,
      clamped.x,
      clamped.y
    );

    // Add to state
    this.state.entities.set(clampedAvatar.entityId, clampedAvatar);

    // Return event
    const event: WorldEvent = {
      type: 'ENTITY_JOINED',
      entity: {
        entityId: clampedAvatar.entityId,
        displayName: clampedAvatar.displayName,
        x: clampedAvatar.x,
        y: clampedAvatar.y,
      },
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
  getEntity(entityId: string): Avatar | undefined {
    return this.state.entities.get(entityId);
  }
}
