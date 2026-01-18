import type { Entity } from '../entities/entity';

// ============================================================================
// WORLD ACTIONS - The ONLY way to mutate world state
// ============================================================================

/** Move action - relocate entity to grid coordinates */
// DEPRECATED: Use SET_DIRECTION for gameplay
export interface MoveAction {
  readonly type: 'MOVE';
  readonly x: number;
  readonly y: number;
}

export interface SetDirectionAction {
  readonly type: 'SET_DIRECTION';
  readonly dx: 0 | 1 | -1;
  readonly dy: 0 | 1 | -1;
}

/** Stand still action - entity stops moving */
export interface StandStillAction {
  readonly type: 'STAND_STILL';
}

/** Request conversation with another entity */
export interface RequestConversationAction {
  readonly type: 'REQUEST_CONVERSATION';
  readonly targetEntityId: string;
}

/** Accept a conversation request */
export interface AcceptConversationAction {
  readonly type: 'ACCEPT_CONVERSATION';
  readonly requestId: string;
}

/** Reject a conversation request */
export interface RejectConversationAction {
  readonly type: 'REJECT_CONVERSATION';
  readonly requestId: string;
}

/** End current conversation */
export interface EndConversationAction {
  readonly type: 'END_CONVERSATION';
}

/** Discriminated union of all possible actions */
export type WorldAction = 
  | MoveAction 
  | SetDirectionAction
  | StandStillAction
  | RequestConversationAction
  | AcceptConversationAction
  | RejectConversationAction
  | EndConversationAction;

// ============================================================================
// WORLD EVENTS - Outputs returned by the world (never mutate external systems)
// ============================================================================

/** Emitted when an entity joins the world */
export interface EntityJoinedEvent {
  readonly type: 'ENTITY_JOINED';
  readonly entity: Entity;
}

/** Emitted when an entity leaves the world */
export interface EntityLeftEvent {
  readonly type: 'ENTITY_LEFT';
  readonly entityId: string;
}

/** Emitted when an entity moves */
export interface EntityMovedEvent {
  readonly type: 'ENTITY_MOVED';
  readonly entityId: string;
  readonly x: number;
  readonly y: number;
  readonly direction?: { x: number; y: number }; // Echo back the direction
  readonly facing?: { x: number; y: number };
}

export interface EntityTurnedEvent {
  readonly type: 'ENTITY_TURNED';
  readonly entityId: string;
  readonly facing: { x: number; y: number };
}

/** Emitted when a conversation request is sent */
export interface ConversationRequestedEvent {
  readonly type: 'CONVERSATION_REQUESTED';
  readonly requestId: string;
  readonly initiatorId: string;
  readonly targetId: string;
  readonly initiatorType: 'PLAYER' | 'ROBOT';
  readonly targetType: 'PLAYER' | 'ROBOT';
  readonly expiresAt: number;
  readonly initiatorName?: string;
  readonly reason?: string;  // Why the agent wants to talk
}

/** Emitted when a conversation request is accepted */
export interface ConversationAcceptedEvent {
  readonly type: 'CONVERSATION_ACCEPTED';
  readonly requestId: string;
  readonly initiatorId: string;
  readonly targetId: string;
  readonly acceptorName?: string;
  readonly reason?: string;  // Why the agent accepted
}

/** Emitted when a conversation request is rejected */
export interface ConversationRejectedEvent {
  readonly type: 'CONVERSATION_REJECTED';
  readonly requestId: string;
  readonly initiatorId: string;
  readonly targetId: string;
  readonly cooldownUntil: number;
  readonly rejectorName?: string;
  readonly reason?: string;  // Why the agent rejected
}

/** Emitted when a conversation starts (both parties are adjacent) */
export interface ConversationStartedEvent {
  readonly type: 'CONVERSATION_STARTED';
  readonly conversationId: string;
  readonly participant1Id: string;
  readonly participant2Id: string;
}

/** Emitted when a conversation ends */
export interface ConversationEndedEvent {
  readonly type: 'CONVERSATION_ENDED';
  readonly conversationId: string;
  readonly participant1Id: string;
  readonly participant2Id: string;
  /** Who ended the conversation (their ID) */
  readonly endedBy?: string;
  /** Name of who ended the conversation */
  readonly endedByName?: string;
  /** Reason for ending (if agent-initiated) */
  readonly reason?: string;
}

/** Emitted when entity state changes (for real-time sync) */
export interface EntityStateChangedEvent {
  readonly type: 'ENTITY_STATE_CHANGED';
  readonly entityId: string;
  readonly conversationState?: 'IDLE' | 'PENDING_REQUEST' | 'WALKING_TO_CONVERSATION' | 'IN_CONVERSATION';
  readonly conversationTargetId?: string;
  readonly conversationPartnerId?: string;
}

/** Emitted when entity stats change (energy, hunger, etc.) */
export interface EntityStatsUpdatedEvent {
  readonly type: 'ENTITY_STATS_UPDATED';
  readonly entityId: string;
  readonly stats: {
    energy?: number;
    hunger?: number;
    loneliness?: number;
    mood?: number;
  };
}

/** Discriminated union of all world events */
export type WorldEvent =
  | EntityJoinedEvent
  | EntityLeftEvent
  | EntityMovedEvent
  | EntityTurnedEvent
  | ConversationRequestedEvent
  | ConversationAcceptedEvent
  | ConversationRejectedEvent
  | ConversationStartedEvent
  | ConversationEndedEvent
  | EntityStateChangedEvent
  | EntityStatsUpdatedEvent;

// ============================================================================
// RESULT TYPE - World never throws, returns Result instead
// ============================================================================

export interface ResultOk<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ResultErr {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type Result<T> = ResultOk<T> | ResultErr;

/** Helper to create success result */
export function ok<T>(value: T): ResultOk<T> {
  return { ok: true, value };
}

/** Helper to create error result */
export function err(code: string, message: string): ResultErr {
  return { ok: false, error: { code, message } };
}
