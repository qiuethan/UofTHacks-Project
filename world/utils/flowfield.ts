import { MapDef } from '../map/mapDef';

interface Point {
  x: number;
  y: number;
}

interface FlowVector {
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
}

/**
 * Flow Field Pathfinding
 * 
 * Generates a vector field that points each cell toward a target.
 * More efficient than per-agent pathfinding when multiple agents share the same goal.
 * 
 * Algorithm:
 * 1. Use Dijkstra's algorithm to calculate cost from target to all cells
 * 2. For each cell, create a vector pointing to the lowest-cost neighbor
 * 3. Agents follow the flow field vectors to reach the target
 */

export interface FlowField {
  readonly target: Point;
  readonly vectors: Map<string, FlowVector>; // "x,y" -> direction vector
  readonly costs: Map<string, number>; // "x,y" -> cost to reach target
}

/**
 * Generate a flow field for a given target position.
 * Uses Dijkstra's algorithm to compute costs, then generates flow vectors.
 */
export function generateFlowField(
  map: MapDef,
  target: Point,
  obstacles: Set<string> // "x,y" strings of blocked cells
): FlowField {
  const costs = new Map<string, number>();
  const vectors = new Map<string, FlowVector>();
  
  // Priority queue: [cost, point]
  const queue: Array<[number, Point]> = [[0, target]];
  const targetKey = `${target.x},${target.y}`;
  costs.set(targetKey, 0);
  
  // Dijkstra's algorithm to compute cost field
  while (queue.length > 0) {
    // Sort by cost (simple priority queue)
    queue.sort((a, b) => a[0] - b[0]);
    const [currentCost, current] = queue.shift()!;
    const currentKey = `${current.x},${current.y}`;
    
    // Skip if we've found a better path already
    if (costs.get(currentKey)! < currentCost) {
      continue;
    }
    
    // Check all 4 cardinal neighbors
    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];
    
    for (const neighbor of neighbors) {
      // Check if 1x1 entity can fit at this position
      const isValid =
        neighbor.x >= 0 && neighbor.x < map.width &&
        neighbor.y >= 0 && neighbor.y < map.height &&
        !obstacles.has(`${neighbor.x},${neighbor.y}`);
      
      if (!isValid) continue;
      
      const neighborKey = `${neighbor.x},${neighbor.y}`;
      const newCost = currentCost + 1;
      
      // Update if we found a better path
      if (!costs.has(neighborKey) || newCost < costs.get(neighborKey)!) {
        costs.set(neighborKey, newCost);
        queue.push([newCost, neighbor]);
      }
    }
  }
  
  // Generate flow vectors based on cost gradient
  for (const [key, cost] of costs.entries()) {
    if (key === targetKey) {
      // At target, no movement needed
      vectors.set(key, { x: 0, y: 0 });
      continue;
    }
    
    const [xStr, yStr] = key.split(',');
    const x = parseInt(xStr);
    const y = parseInt(yStr);
    
    // Find neighbor with lowest cost
    const neighbors = [
      { pos: { x: x + 1, y }, dir: { x: 1 as 1, y: 0 as 0 } },
      { pos: { x: x - 1, y }, dir: { x: -1 as -1, y: 0 as 0 } },
      { pos: { x, y: y + 1 }, dir: { x: 0 as 0, y: 1 as 1 } },
      { pos: { x, y: y - 1 }, dir: { x: 0 as 0, y: -1 as -1 } },
    ];
    
    let bestDir: FlowVector = { x: 0, y: 0 };
    let bestCost = cost;
    
    for (const { pos, dir } of neighbors) {
      const neighborKey = `${pos.x},${pos.y}`;
      const neighborCost = costs.get(neighborKey);
      
      if (neighborCost !== undefined && neighborCost < bestCost) {
        bestCost = neighborCost;
        bestDir = dir;
      }
    }
    
    vectors.set(key, bestDir);
  }
  
  return {
    target,
    vectors,
    costs,
  };
}

/**
 * Get the flow vector at a given position.
 * Returns null if position is not in the flow field (unreachable).
 */
export function getFlowVector(field: FlowField, pos: Point): FlowVector | null {
  const key = `${pos.x},${pos.y}`;
  return field.vectors.get(key) || null;
}

/**
 * Check if a position is reachable in the flow field.
 */
export function isReachable(field: FlowField, pos: Point): boolean {
  const key = `${pos.x},${pos.y}`;
  return field.costs.has(key);
}

/**
 * Get the cost to reach the target from a given position.
 * Returns Infinity if unreachable.
 */
export function getCost(field: FlowField, pos: Point): number {
  const key = `${pos.x},${pos.y}`;
  return field.costs.get(key) ?? Infinity;
}
