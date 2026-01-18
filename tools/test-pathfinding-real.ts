import { findPath } from '../world/utils/pathfinding';
import { MAIN_MAP } from '../world/map/index';
import { isTileBlocked } from '../world/map/mapDef';

interface TestCase {
  name: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  obstacles: Set<string>;
  expectPath: boolean;
}

// Find some good open positions first
function findOpenPositions(count: number): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  
  for (let y = 0; y < MAIN_MAP.height && positions.length < count; y++) {
    for (let x = 0; x < MAIN_MAP.width - 1 && positions.length < count; x++) {
      const tile1 = isTileBlocked(MAIN_MAP, x, y);
      const tile2 = isTileBlocked(MAIN_MAP, x + 1, y);
      
      if (!tile1 && !tile2) {
        positions.push({ x, y });
      }
    }
  }
  
  return positions;
}

const openPositions = findOpenPositions(20);

console.log('==========================================');
console.log('REAL PATHFINDING TEST');
console.log('==========================================\n');
console.log(`Map size: ${MAIN_MAP.width}x${MAIN_MAP.height}`);
console.log(`Entity size: 2x1 (width 2, height 1)`);
console.log(`Found ${openPositions.length} open positions for testing\n`);

const testCases: TestCase[] = [
  {
    name: "Short distance in open area",
    start: openPositions[0],
    end: openPositions[5],
    obstacles: new Set(),
    expectPath: true
  },
  {
    name: "Medium distance path",
    start: openPositions[0],
    end: openPositions[10],
    obstacles: new Set(),
    expectPath: true
  },
  {
    name: "Long distance path",
    start: openPositions[0],
    end: openPositions[openPositions.length - 1],
    obstacles: new Set(),
    expectPath: true
  },
  {
    name: "Path with dynamic obstacles",
    start: openPositions[0],
    end: openPositions[8],
    obstacles: new Set([`${openPositions[4].x},${openPositions[4].y}`]),
    expectPath: true
  },
];

let passed = 0;
let failed = 0;

for (const test of testCases) {
  console.log(`\n📋 Test: ${test.name}`);
  console.log(`   Start: (${test.start.x}, ${test.start.y})`);
  console.log(`   End: (${test.end.x}, ${test.end.y})`);
  console.log(`   Distance: ${Math.abs(test.end.x - test.start.x) + Math.abs(test.end.y - test.start.y)} tiles (Manhattan)`);

  const path = findPath(MAIN_MAP, test.start, test.end, test.obstacles);
  const foundPath = path !== null;

  if (foundPath === test.expectPath) {
    console.log(`   ✅ PASS`);
    passed++;
    
    if (path) {
      console.log(`   Path length: ${path.length} steps`);
      console.log(`   First 10 steps: ${path.slice(0, 10).map(p => `(${p.x},${p.y})`).join(' → ')}${path.length > 10 ? ' ...' : ''}`);
    }
  } else {
    console.log(`   ❌ FAIL`);
    console.log(`   Expected path: ${test.expectPath}, Got: ${foundPath}`);
    failed++;
  }
}

console.log('\n==========================================');
console.log('TEST SUMMARY');
console.log('==========================================');
console.log(`Total: ${testCases.length}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('==========================================\n');

// Interactive demonstration
console.log('\n==========================================');
console.log('INTERACTIVE PATHFINDING DEMO');
console.log('==========================================\n');

const demoStart = { x: 19, y: 16 }; // Known open area
const demoEnd = { x: 35, y: 20 };   // Another open area

console.log(`🎯 Demo: Agent walks from (${demoStart.x}, ${demoStart.y}) to (${demoEnd.x}, ${demoEnd.y})\n`);

const demoPath = findPath(MAIN_MAP, demoStart, demoEnd, new Set());

if (demoPath) {
  console.log('✅ Path found!\n');
  console.log(`Total steps: ${demoPath.length}\n`);
  
  // Show movement directions
  console.log('Movement sequence:');
  let current = demoStart;
  demoPath.forEach((step, i) => {
    const dx = step.x - current.x;
    const dy = step.y - current.y;
    let direction = '';
    if (dx > 0) direction = 'RIGHT';
    else if (dx < 0) direction = 'LEFT';
    else if (dy > 0) direction = 'DOWN';
    else if (dy < 0) direction = 'UP';
    console.log(`  ${(i + 1).toString().padStart(3, ' ')}. Move ${direction.padEnd(6, ' ')} → (${step.x}, ${step.y})`);
    current = step;
  });
  
  console.log('\n📝 To make an agent automatically walk to a coordinate in the game:');
  console.log('   1. The AI system already uses this pathfinding in api/app/agent_worker.py');
  console.log('   2. Robots call findPath() to navigate to targets');
  console.log('   3. The path is followed one step at a time in the game loop');
  
} else {
  console.log('❌ No path found between these positions!');
}

console.log('\n==========================================');
console.log('HOW TO TEST IN-GAME');
console.log('==========================================\n');
console.log('1. Start the realtime-server and web client');
console.log('2. Join the game as a player');
console.log('3. Disconnect (close browser tab)');
console.log('4. Your player will convert to a ROBOT');
console.log('5. The AI will use this pathfinding to navigate');
console.log('');
console.log('To manually trigger pathfinding for testing:');
console.log('- Edit realtime-server/src/game.ts');
console.log('- In the AI loop, set a fixed target coordinate');
console.log('- Watch the robot navigate using the pathfinding\n');

if (failed === 0) {
  console.log('✅ All tests passed! Pathfinding is working correctly.\n');
  process.exit(0);
} else {
  console.log('❌ Some tests failed.\n');
  process.exit(1);
}
