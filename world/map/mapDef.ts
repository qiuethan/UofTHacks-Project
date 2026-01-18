// ============================================================================
// MAP DEFINITION - Simple tile-based map
// ============================================================================

// TEMPORARY: Set to true to disable wall collisions for testing
export const DISABLE_WALL_COLLISIONS = true;

export interface MapDef {
  readonly width: number;
  readonly height: number;
  /** Optional collision grid in row-major order [y][x]. true = blocked, false = walkable */
  readonly collisionGrid?: ReadonlyArray<ReadonlyArray<boolean>>;
}

/** Create a new map definition */
export function createMapDef(
  width: number,
  height: number,
  collisionGrid?: ReadonlyArray<ReadonlyArray<boolean>>
): MapDef {
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
    collisionGrid,
  };
}

/** Check if coordinates are within map bounds */
export function isInBounds(map: MapDef, x: number, y: number): boolean {
  return x >= 0 && x < map.width && y >= 0 && y < map.height;
}

/** Clamp coordinates to map bounds */
export function clampToBounds(
  map: MapDef,
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(map.width - 1, Math.floor(x))),
    y: Math.max(0, Math.min(map.height - 1, Math.floor(y))),
  };
}

/**
 * Check if a tile is blocked by static map obstacles.
 * Returns true if out of bounds or if the tile is marked as blocked.
 */
export function isTileBlocked(map: MapDef, x: number, y: number): boolean {
  // Out of bounds = blocked (always check this)
  if (!isInBounds(map, x, y)) {
    return true;
  }

  // TEMPORARY: Skip collision grid check if disabled
  if (DISABLE_WALL_COLLISIONS) {
    return false;
  }

  // Check collision grid if available
  if (map.collisionGrid && map.collisionGrid[y] && map.collisionGrid[y][x]) {
    return true;
  }

  return false;
}
