import { MapDef, isInBounds } from '../map/mapDef';

interface Point {
  x: number;
  y: number;
}

export function findPath(
  map: MapDef,
  start: Point,
  end: Point,
  obstacles: Set<string> // encoded "x,y" strings
): Point[] | null {
  const queue: Point[][] = [[start]];
  const visited = new Set<string>();
  visited.add(`${start.x},${start.y}`);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];

    if (current.x === end.x && current.y === end.y) {
      return path.slice(1); // Return path excluding start
    }

    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];

    for (const neighbor of neighbors) {
      // For a 2x2 entity, check if the entire 2x2 square is valid
      const isNeighborValid =
        neighbor.x >= 0 && neighbor.x + 1 < map.width &&
        neighbor.y >= 0 && neighbor.y + 1 < map.height &&
        !obstacles.has(`${neighbor.x},${neighbor.y}`) &&
        !obstacles.has(`${neighbor.x + 1},${neighbor.y}`) &&
        !obstacles.has(`${neighbor.x},${neighbor.y + 1}`) &&
        !obstacles.has(`${neighbor.x + 1},${neighbor.y + 1}`);

      const key = `${neighbor.x},${neighbor.y}`; // Use top-left for visited key
      if (
        isNeighborValid &&
        !visited.has(key)
      ) {
        visited.add(key);
        queue.push([...path, neighbor]);
      }
    }
  }

  return null;
}
