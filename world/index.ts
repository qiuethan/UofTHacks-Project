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
export type { Entity, SpriteUrls } from './entities/entity';

// Map
export { createMapDef, isInBounds, clampToBounds, isTileBlocked, MAIN_MAP } from './map';
export type { MapDef } from './map';

// Actions & Events
export type {
  WorldAction,
  MoveAction,
  SetDirectionAction,
  StandStillAction,
  RequestConversationAction,
  AcceptConversationAction,
  RejectConversationAction,
  EndConversationAction,
  WorldEvent,
  EntityJoinedEvent,
  EntityLeftEvent,
  EntityMovedEvent,
  ConversationRequestedEvent,
  ConversationAcceptedEvent,
  ConversationRejectedEvent,
  ConversationStartedEvent,
  ConversationEndedEvent,
  Result,
  ResultOk,
  ResultErr,
} from './actions';
export { ok, err } from './actions';

// Conversation utilities
export {
  CONVERSATION_CONFIG,
  ConversationRequestManager,
  CooldownTracker,
  getDistance,
  isWithinInitiationRange,
  isWithinConversationRange,
  areAdjacent,
  calculateAIInterestToInitiate,
  calculateAIInterestToAccept,
  shouldAIInitiate,
  shouldAIAccept,
} from './utils/conversation';
export type { ConversationRequest, ActiveConversation } from './utils/conversation';

// Pipeline (exposed for testing/advanced use)
export { validateAction, applyAction, processAction } from './actions';

// State (exposed for testing/advanced use)
export type { WorldState } from './state';
export { createWorldState, getEntity, hasEntity, getAllEntities } from './state';

// Reservation table for space-time coordination
export { ReservationTable, resolveMoves } from './utils/reservations';
export type { MoveProposal } from './utils/reservations';

// WHCA* cooperative pathfinding
export { planCooperativePaths, getNextMove } from './utils/whca';

// Pathfinding
export { findPath } from './utils/pathfinding';