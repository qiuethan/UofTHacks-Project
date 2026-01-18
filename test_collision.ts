import { World, createMapDef, createWall, createAvatar } from './world/index.ts';

function test() {
  const world = new World(createMapDef(10, 10));

  // Add a wall at (2, 2)
  // Covers (2,2), (3,2), (2,3), (3,3)
  const wall = createWall('wall-1', 2, 2);
  world.addEntity(wall);

  const avatar = createAvatar('player-1', 'Player', 4, 2);
  world.addEntity(avatar);

  console.log('--- Test 1: Moving into wall from right ---');
  console.log('Initial Pos:', world.getEntity('player-1')?.x, world.getEntity('player-1')?.y);
  
  // Move from (4,2) to (3,2)
  // (3,2) overlaps with wall at (3,2) and (3,3)
  world.submitAction('player-1', { type: 'SET_DIRECTION', dx: -1, dy: 0 });
  world.tick();
  console.log('Pos after tick:', world.getEntity('player-1')?.x, world.getEntity('player-1')?.y);
  
  if (world.getEntity('player-1')?.x === 4) {
    console.log('SUCCESS: Blocked correctly');
  } else {
    console.log('FAILURE: Moved into wall');
  }

  console.log('\n--- Test 2: Moving past wall (no collision) ---');
  // Reset pos to (4,4)
  world.removeEntity('player-1');
  world.addEntity(createAvatar('player-1', 'Player', 4, 4));
  console.log('Initial Pos:', world.getEntity('player-1')?.x, world.getEntity('player-1')?.y);

  // Move from (4,4) to (4,3) - wait, (4,4) top-left means it occupies (4,4), (5,4), (4,5), (5,5)
  // Wall at (2,2) occupies (2,2), (3,2), (2,3), (3,3)
  // Move to (4,3). Actor (4,3), (5,3), (4,4), (5,4).
  // Wall (2,2), (3,2), (2,3), (3,3).
  // x-diff: abs(4-2)=2. Not < 2. No collision.
  world.submitAction('player-1', { type: 'SET_DIRECTION', dx: 0, dy: -1 });
  world.tick();
  console.log('Pos after tick:', world.getEntity('player-1')?.x, world.getEntity('player-1')?.y);
  
  if (world.getEntity('player-1')?.y === 3) {
    console.log('SUCCESS: Moved correctly (no collision)');
  } else {
    console.log('FAILURE: Blocked incorrectly');
  }

  console.log('\n--- Test 3: Diagonal overlap check ---');
  // Wall at (2,2)
  // Move actor to (3,3)
  // Actor (3,3), (4,3), (3,4), (4,4)
  // Wall (2,2), (3,2), (2,3), (3,3)
  // Overlap at (3,3).
  // abs(3-2)=1 < 2. abs(3-2)=1 < 2. Should collide.
  world.removeEntity('player-1');
  world.addEntity(createAvatar('player-1', 'Player', 4, 4));
  world.submitAction('player-1', { type: 'SET_DIRECTION', dx: -1, dy: -1 });
  // Wait, SET_DIRECTION prioritizes X if diagonal.
  // Let's manually set position to (4,4) and try to move to (3,3) via discrete moves.
  
  world.submitAction('player-1', { type: 'SET_DIRECTION', dx: -1, dy: 0 }); // Move to (3,4)
  world.tick();
  console.log('Pos at (3,4):', world.getEntity('player-1')?.x, world.getEntity('player-1')?.y);
  
  world.submitAction('player-1', { type: 'SET_DIRECTION', dx: 0, dy: -1 }); // Try to move to (3,3)
  world.tick();
  console.log('Pos after trying to move to (3,3):', world.getEntity('player-1')?.x, world.getEntity('player-1')?.y);

  if (world.getEntity('player-1')?.y === 4) {
    console.log('SUCCESS: Blocked correctly');
  } else {
    console.log('FAILURE: Moved into wall');
  }
}

test();