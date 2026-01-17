// ============================================================================
// WALL CONFIGURATION
// Define wall positions here to match your background.png
// Each wall is a 2x2 tile block. Add coordinates where walls should be.
// ============================================================================

import { MAP_WIDTH, MAP_HEIGHT } from './config';

export interface WallRect {
  x: number;      // Starting x position
  y: number;      // Starting y position
  width: number;  // Width in tiles (will place walls every 2 tiles)
  height: number; // Height in tiles (will place walls every 2 tiles)
}

// Define wall rectangles that match your background.png
// Example: A wall from (10,10) to (20,12) would be: { x: 10, y: 10, width: 10, height: 2 }
export const WALL_RECTANGLES: WallRect[] = [
  // ============================================================================
  // ADD YOUR WALL DEFINITIONS HERE
  // Look at your background.png and define rectangles where walls should be
  // ============================================================================
  
  // Example walls (remove these and add your own):
  // { x: 10, y: 10, width: 20, height: 2 },  // Horizontal wall
  // { x: 30, y: 5, width: 2, height: 30 },   // Vertical wall
];

// Generate all wall positions from rectangles
// NO perimeter walls - only walls you explicitly define
export function generateWallPositions(): Array<{ x: number; y: number; id: string }> {
  const walls: Array<{ x: number; y: number; id: string }> = [];
  const usedPositions = new Set<string>();
  
  // Helper to add a wall if position is valid and not already used
  const addWall = (x: number, y: number, source: string) => {
    const key = `${x},${y}`;
    if (!usedPositions.has(key) && x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT) {
      usedPositions.add(key);
      walls.push({ x, y, id: `wall-${source}-${x}-${y}` });
    }
  };
  
  // Add walls from rectangles only (no automatic perimeter walls)
  for (const rect of WALL_RECTANGLES) {
    for (let x = rect.x; x < rect.x + rect.width; x += 2) {
      for (let y = rect.y; y < rect.y + rect.height; y += 2) {
        addWall(x, y, 'rect');
      }
    }
  }
  
  return walls;
}

// Individual wall positions (for more precise control)
// Add specific x,y coordinates for walls that don't fit in rectangles
export const INDIVIDUAL_WALLS: Array<{ x: number; y: number }> = [
  // Example: { x: 15, y: 25 },
];
