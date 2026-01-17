import { Entity, createEntity } from './entity';

export function createWall(id: string, x: number, y: number): Entity {
  return createEntity(id, 'WALL', 'Wall', x, y, '#4a5568'); // Gray color
}
