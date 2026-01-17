// ============================================================================
// AVATAR - Represents a person or agent in the world
// Both humans and AI are treated identically as Avatars
// ============================================================================

export interface Avatar {
  readonly entityId: string;
  readonly displayName: string;
  /** Tile/grid X coordinate (integer) */
  readonly x: number;
  /** Tile/grid Y coordinate (integer) */
  readonly y: number;
}

/** Create a new Avatar with validated fields */
export function createAvatar(
  entityId: string,
  displayName: string,
  x: number,
  y: number
): Avatar {
  return {
    entityId,
    displayName,
    x: Math.floor(x),
    y: Math.floor(y),
  };
}
