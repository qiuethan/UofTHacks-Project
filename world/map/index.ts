export * from './mapDef';
import { createMapDef } from './mapDef';
import { COLLISION_GRID, MAP_WIDTH, MAP_HEIGHT } from './collisionData';

/**
 * The main map with collision data loaded from the Tiled map.
 * Dimensions: 60x40 tiles at 16px each.
 */
export const MAIN_MAP = createMapDef(MAP_WIDTH, MAP_HEIGHT, COLLISION_GRID);
