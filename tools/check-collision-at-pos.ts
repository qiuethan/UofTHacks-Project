import { MAIN_MAP } from '../world/map/index';
import { isTileBlocked } from '../world/map/mapDef';

function checkPosition(x: number, y: number, label: string) {
  console.log(`\n${label}: (${x}, ${y})`);
  
  // Check if position is in bounds
  if (x < 0 || x >= MAIN_MAP.width || y < 0 || y >= MAIN_MAP.height) {
    console.log('  ❌ OUT OF BOUNDS');
    return;
  }

  // Check for 2x1 entity (top-left corner at x,y)
  const tile1 = isTileBlocked(MAIN_MAP, x, y);
  const tile2 = isTileBlocked(MAIN_MAP, x + 1, y);
  
  console.log(`  Tile (${x}, ${y}): ${tile1 ? '🧱 BLOCKED' : '✅ OPEN'}`);
  console.log(`  Tile (${x + 1}, ${y}): ${tile2 ? '🧱 BLOCKED' : '✅ OPEN'}`);
  console.log(`  Can place 2x1 entity: ${!tile1 && !tile2 && x + 1 < MAIN_MAP.width ? '✅ YES' : '❌ NO'}`);
}

console.log('==========================================');
console.log('COLLISION CHECKER');
console.log('==========================================');
console.log(`Map size: ${MAIN_MAP.width}x${MAIN_MAP.height}\n`);

// Check the test positions that were failing
checkPosition(2, 2, 'Test 1 Start');
checkPosition(6, 2, 'Test 1 End');
checkPosition(5, 5, 'Test 4 Start');
checkPosition(25, 15, 'Test 4 End');
checkPosition(0, 0, 'Test 5 Start');
checkPosition(5, 20, 'Interactive Test Start');
checkPosition(30, 25, 'Interactive Test End');

// Check some positions we know should be open
console.log('\n\n==========================================');
console.log('FINDING OPEN AREAS');
console.log('==========================================\n');

let openPositions = [];
for (let y = 0; y < MAIN_MAP.height && openPositions.length < 10; y++) {
  for (let x = 0; x < MAIN_MAP.width - 1 && openPositions.length < 10; x++) {
    const tile1 = isTileBlocked(MAIN_MAP, x, y);
    const tile2 = isTileBlocked(MAIN_MAP, x + 1, y);
    
    if (!tile1 && !tile2) {
      openPositions.push({ x, y });
    }
  }
}

console.log('First 10 open positions for 2x1 entities:');
openPositions.forEach((pos, i) => {
  console.log(`  ${i + 1}. (${pos.x}, ${pos.y})`);
});

// Suggest good test coordinates
if (openPositions.length >= 2) {
  console.log('\n\n==========================================');
  console.log('SUGGESTED TEST COORDINATES');
  console.log('==========================================\n');
  console.log(`Start: (${openPositions[0].x}, ${openPositions[0].y})`);
  console.log(`End: (${openPositions[openPositions.length - 1].x}, ${openPositions[openPositions.length - 1].y})`);
  console.log('\nUse these coordinates for testing pathfinding in open areas.');
}
