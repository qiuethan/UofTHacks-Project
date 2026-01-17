// ============================================================================
// MAP DEFINITION - Simple tile-based map
// ============================================================================

export interface MapDef {
  readonly width: number;
  readonly height: number;
  // TODO: Add blocked tiles array for collision support
  // readonly blockedTiles?: ReadonlySet<string>; // e.g., "x,y" format
}

/** Create a new map definition */
export function createMapDef(width: number, height: number): MapDef {
  return {
    width: Math.max(1, Math.floor(width)),
    height: Math.max(1, Math.floor(height)),
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

// TODO: Add collision detection helpers
// export function isTileBlocked(map: MapDef, x: number, y: number): boolean
