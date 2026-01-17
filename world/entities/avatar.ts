import { Entity, createEntity } from './entity';

export type Avatar = Entity;

/** Create a new Avatar with validated fields */
export function createAvatar(
  entityId: string,
  displayName: string,
  x: number,
  y: number,
  facing?: { x: 0 | 1 | -1; y: 0 | 1 | -1 }
): Avatar {
  return createEntity(entityId, 'PLAYER', displayName, x, y, undefined, facing);
}

export function createRobot(
  entityId: string,
  x: number,
  y: number
): Avatar {
  return createEntity(entityId, 'ROBOT', 'Bot', x, y, '#f56565'); // Red color
}
