// ============================================================================
// WORLD STATE - The single source of truth for the simulation
// ============================================================================

import type { Avatar } from '../entities/avatar';
import type { MapDef } from '../map/mapDef';

export interface WorldState {
  readonly map: MapDef;
  /** Map of entityId -> Avatar for O(1) lookups */
  readonly entities: Map<string, Avatar>;
}

/** Create initial world state */
export function createWorldState(map: MapDef): WorldState {
  return {
    map,
    entities: new Map(),
  };
}

/** Get entity by ID (returns undefined if not found) */
export function getEntity(state: WorldState, entityId: string): Avatar | undefined {
  return state.entities.get(entityId);
}

/** Check if entity exists */
export function hasEntity(state: WorldState, entityId: string): boolean {
  return state.entities.has(entityId);
}

/** Get all entities as array */
export function getAllEntities(state: WorldState): Avatar[] {
  return Array.from(state.entities.values());
}
