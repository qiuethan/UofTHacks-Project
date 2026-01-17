// ============================================================================
// WORLD MODULE - Single source of truth for the 2D multiplayer simulation
// ============================================================================

// Core engine
export { World } from './engine';
export type { WorldSnapshot } from './engine/world';

// Entities
export { createAvatar, createRobot } from './entities/avatar';
export { createWall } from './entities/wall';
export { createEntity } from './entities/entity';
export type { Avatar } from './entities/avatar';
export type { Entity } from './entities/entity';

// Map
export { createMapDef, isInBounds, clampToBounds } from './map';
export type { MapDef } from './map';

// Actions & Events
export type {
  WorldAction,
  MoveAction,
  SetDirectionAction,
  WorldEvent,
  EntityJoinedEvent,
  EntityLeftEvent,
  EntityMovedEvent,
  Result,
  ResultOk,
  ResultErr,
} from './actions';
export { ok, err } from './actions';

// Pipeline (exposed for testing/advanced use)
export { validateAction, applyAction, processAction } from './actions';

// State (exposed for testing/advanced use)
export type { WorldState } from './state';
export { createWorldState, getEntity, hasEntity, getAllEntities } from './state';