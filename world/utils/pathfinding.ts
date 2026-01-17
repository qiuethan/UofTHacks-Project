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
      const key = `${neighbor.x},${neighbor.y}`;
      if (
        isInBounds(map, neighbor.x, neighbor.y) &&
        !obstacles.has(key) &&
        !visited.has(key)
      ) {
        visited.add(key);
        queue.push([...path, neighbor]);
      }
    }
  }

  return null;
}
