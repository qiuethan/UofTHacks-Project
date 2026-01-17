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

/** Discriminated union of all possible actions */
export type WorldAction = MoveAction | SetDirectionAction;

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
}

/** Discriminated union of all world events */
export type WorldEvent =
  | EntityJoinedEvent
  | EntityLeftEvent
  | EntityMovedEvent;

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
