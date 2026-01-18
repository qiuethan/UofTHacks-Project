import { MapDef } from '../map/mapDef';

interface Point {
  x: number;
  y: number;
}

interface TimePoint extends Point {
  t: number; // Time step
}

/**
 * Windowed Hierarchical Cooperative A* (WHCA*)
 * 
 * A multi-agent pathfinding algorithm that coordinates robot movements
 * to avoid collisions by planning paths in space-time.
 * 
 * Key concepts:
 * - Each robot plans a path considering other robots' planned paths
 * - Uses a time window (w) to limit planning horizon
 * - Robots reserve space-time cells to prevent collisions
 * - Higher priority robots plan first
 */

interface ReservationTable {
  // "x,y,t" -> entityId that reserved this space-time cell
  reservations: Map<string, string>;
}

interface PathNode {
  x: number;
  y: number;
  t: number;
  g: number; // Cost from start
  h: number; // Heuristic to goal
  f: number; // g + h
  parent: PathNode | null;
}

const WINDOW_SIZE = 10; // Plan ahead 10 time steps
const MAX_PLANNING_TIME = 50; // Maximum time steps to plan

/**
 * Calculate Manhattan distance heuristic for 2x2 entities
 */
function heuristic(from: Point, to: Point): number {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
}

/**
 * Check if a 1x1 entity can occupy a position at time t
 */
function isValidPosition(
  pos: Point,
  t: number,
  map: MapDef,
  obstacles: Set<string>,
  reservations: ReservationTable,
  entityId: string
): boolean {
  // Check map bounds for 1x1 entity
  if (pos.x < 0 || pos.x >= map.width || pos.y < 0 || pos.y >= map.height) {
    return false;
  }

  // Check static obstacles (walls) - only 1 cell for 1x1 hitbox
  const cells = [`${pos.x},${pos.y}`];

  for (const cell of cells) {
    if (obstacles.has(cell)) {
      return false;
    }
  }

  // Check space-time reservations (other robots)
  for (const cell of cells) {
    const key = `${cell},${t}`;
    const reserved = reservations.reservations.get(key);
    if (reserved && reserved !== entityId) {
      return false;
    }
  }

  return true;
}

/**
 * Reserve space-time cells for a path (1x1 hitbox)
 */
function reservePath(
  path: Point[],
  startTime: number,
  entityId: string,
  reservations: ReservationTable
): void {
  for (let i = 0; i < path.length; i++) {
    const pos = path[i];
    const t = startTime + i;
    
    // 1x1 hitbox: only 1 cell
    const cells = [`${pos.x},${pos.y}`];

    for (const cell of cells) {
      const key = `${cell},${t}`;
      reservations.reservations.set(key, entityId);
    }
  }
}

/**
 * A* pathfinding in space-time with reservations
 */
function findSpaceTimePath(
  start: Point,
  goal: Point,
  startTime: number,
  map: MapDef,
  obstacles: Set<string>,
  reservations: ReservationTable,
  entityId: string,
  windowSize: number
): Point[] | null {
  const openSet: PathNode[] = [];
  const closedSet = new Set<string>();

  const startNode: PathNode = {
    x: start.x,
    y: start.y,
    t: startTime,
    g: 0,
    h: heuristic(start, goal),
    f: heuristic(start, goal),
    parent: null,
  };

  openSet.push(startNode);

  while (openSet.length > 0) {
    // Get node with lowest f score
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift()!;

    const currentKey = `${current.x},${current.y},${current.t}`;
    if (closedSet.has(currentKey)) continue;
    closedSet.add(currentKey);

    // Check if reached goal
    if (current.x === goal.x && current.y === goal.y) {
      // Reconstruct path
      const path: Point[] = [];
      let node: PathNode | null = current;
      while (node) {
        path.unshift({ x: node.x, y: node.y });
        node = node.parent;
      }
      return path;
    }

    // Stop if we've exceeded window or max planning time
    if (current.t - startTime >= windowSize || current.t >= startTime + MAX_PLANNING_TIME) {
      continue;
    }

    // Generate neighbors (including wait action)
    const neighbors = [
      { x: current.x + 1, y: current.y }, // right
      { x: current.x - 1, y: current.y }, // left
      { x: current.x, y: current.y + 1 }, // down
      { x: current.x, y: current.y - 1 }, // up
      { x: current.x, y: current.y },     // wait
    ];

    for (const neighbor of neighbors) {
      const nextT = current.t + 1;

      if (!isValidPosition(neighbor, nextT, map, obstacles, reservations, entityId)) {
        continue;
      }

      const neighborKey = `${neighbor.x},${neighbor.y},${nextT}`;
      if (closedSet.has(neighborKey)) continue;

      const g = current.g + 1;
      const h = heuristic(neighbor, goal);
      const f = g + h;

      const neighborNode: PathNode = {
        x: neighbor.x,
        y: neighbor.y,
        t: nextT,
        g,
        h,
        f,
        parent: current,
      };

      openSet.push(neighborNode);
    }
  }

  return null; // No path found
}

/**
 * Plan paths for multiple robots using WHCA*
 */
export function planCooperativePaths(
  robots: Array<{ id: string; start: Point; goal: Point }>,
  map: MapDef,
  obstacles: Set<string>,
  currentTime: number
): Map<string, Point[]> {
  const reservations: ReservationTable = {
    reservations: new Map(),
  };

  const paths = new Map<string, Point[]>();

  // Sort robots by priority (can use distance to goal, or fixed priority)
  const sortedRobots = [...robots].sort((a, b) => {
    const distA = heuristic(a.start, a.goal);
    const distB = heuristic(b.start, b.goal);
    return distA - distB; // Closer robots plan first
  });

  // Plan path for each robot in order
  for (const robot of sortedRobots) {
    const path = findSpaceTimePath(
      robot.start,
      robot.goal,
      currentTime,
      map,
      obstacles,
      reservations,
      robot.id,
      WINDOW_SIZE
    );

    if (path && path.length > 0) {
      paths.set(robot.id, path);
      // Reserve this path in space-time
      reservePath(path, currentTime, robot.id, reservations);
    } else {
      // No path found - robot stays in place
      paths.set(robot.id, [robot.start]);
    }
  }

  return paths;
}

/**
 * Get next move for a robot from its planned path
 */
export function getNextMove(
  robotId: string,
  currentPos: Point,
  plannedPaths: Map<string, Point[]>
): { x: -1 | 0 | 1; y: -1 | 0 | 1 } | null {
  const path = plannedPaths.get(robotId);
  if (!path || path.length === 0) {
    return null;
  }

  // Path includes current position, so next step is index 1
  if (path.length > 1) {
    const next = path[1];
    const dx = next.x - currentPos.x;
    const dy = next.y - currentPos.y;

    // Clamp to valid direction
    return {
      x: Math.max(-1, Math.min(1, dx)) as -1 | 0 | 1,
      y: Math.max(-1, Math.min(1, dy)) as -1 | 0 | 1,
    };
  }

  // Already at goal or only one step
  return { x: 0, y: 0 };
}
