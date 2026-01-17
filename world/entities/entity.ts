export type EntityType = 'PLAYER' | 'WALL' | 'ROBOT';

export interface Entity {
  readonly entityId: string;
  readonly kind: EntityType;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly color?: string;
  // Movement intent (for tick-based movement)
  readonly direction?: { x: 0 | 1 | -1; y: 0 | 1 | -1 };
  // AI Goal
  readonly targetPosition?: { x: number; y: number };
}

export function createEntity(
  entityId: string,
  kind: EntityType,
  displayName: string,
  x: number,
  y: number,
  color?: string
): Entity {
  return {
    entityId,
    kind,
    displayName,
    x: Math.floor(x),
    y: Math.floor(y),
    color,
    direction: { x: 0, y: 0 } // Default no movement
  };
}
