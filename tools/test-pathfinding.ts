import { findPath } from '../world/utils/pathfinding';
import { MAIN_MAP } from '../world/map/index';

interface TestCase {
  name: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  obstacles: Set<string>;
  expectPath: boolean;
}

const testCases: TestCase[] = [
  {
    name: "Simple straight line (no obstacles)",
    start: { x: 2, y: 2 },
    end: { x: 6, y: 2 },
    obstacles: new Set(),
    expectPath: true
  },
  {
    name: "Path around obstacles",
    start: { x: 2, y: 2 },
    end: { x: 2, y: 6 },
    obstacles: new Set(['2,3', '2,4']), // Block direct path
    expectPath: true
  },
  {
    name: "Impossible path (completely blocked)",
    start: { x: 2, y: 2 },
    end: { x: 2, y: 6 },
    obstacles: new Set([
      '1,3', '2,3', '3,3', '4,3',  // Horizontal wall
    ]),
    expectPath: false
  },
  {
    name: "Long distance path",
    start: { x: 5, y: 5 },
    end: { x: 25, y: 15 },
    obstacles: new Set(),
    expectPath: true
  },
  {
    name: "Path avoiding map boundaries",
    start: { x: 0, y: 0 },
    end: { x: 5, y: 5 },
    obstacles: new Set(),
    expectPath: true
  },
  {
    name: "Destination blocked",
    start: { x: 2, y: 2 },
    end: { x: 5, y: 5 },
    obstacles: new Set(['5,5', '6,5']), // Block destination
    expectPath: false
  },
  {
    name: "Path with collision data (real map test)",
    start: { x: 2, y: 16 }, // Open area
    end: { x: 10, y: 16 },  // Should navigate around walls
    obstacles: new Set(),
    expectPath: true
  },
];

function visualizePath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  path: { x: number; y: number }[] | null,
  obstacles: Set<string>,
  gridSize: { width: number; height: number } = { width: 15, height: 10 }
) {
  console.log('\n  Visual Map:');
  for (let y = 0; y < gridSize.height; y++) {
    let row = '  ';
    for (let x = 0; x < gridSize.width; x++) {
      const key = `${x},${y}`;
      if (x === start.x && y === start.y) {
        row += 'S '; // Start
      } else if (x === end.x && y === end.y) {
        row += 'E '; // End
      } else if (path && path.some(p => p.x === x && p.y === y)) {
        row += '• '; // Path
      } else if (obstacles.has(key)) {
        row += '█ '; // Obstacle
      } else {
        row += '. '; // Empty
      }
    }
    console.log(row);
  }
}

function runTests() {
  console.log('==========================================');
  console.log('PATHFINDING TEST SUITE');
  console.log('==========================================\n');
  console.log(`Map size: ${MAIN_MAP.width}x${MAIN_MAP.height}`);
  console.log(`Entity size: 2x1 (width 2, height 1)\n`);

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    console.log(`\n📋 Test: ${test.name}`);
    console.log(`   Start: (${test.start.x}, ${test.start.y})`);
    console.log(`   End: (${test.end.x}, ${test.end.y})`);
    console.log(`   Obstacles: ${test.obstacles.size} dynamic obstacles`);

    const path = findPath(MAIN_MAP, test.start, test.end, test.obstacles);
    const foundPath = path !== null;

    if (foundPath === test.expectPath) {
      console.log(`   ✅ PASS`);
      passed++;
      
      if (path) {
        console.log(`   Path length: ${path.length} steps`);
        console.log(`   Path: ${path.slice(0, 5).map(p => `(${p.x},${p.y})`).join(' → ')}${path.length > 5 ? ' ...' : ''}`);
        
        // Visualize short paths
        if (test.start.x < 15 && test.start.y < 10 && test.end.x < 15 && test.end.y < 10) {
          visualizePath(test.start, test.end, path, test.obstacles);
        }
      } else {
        console.log(`   No path found (as expected)`);
      }
    } else {
      console.log(`   ❌ FAIL`);
      console.log(`   Expected path: ${test.expectPath}, Got: ${foundPath}`);
      failed++;
      
      if (path && test.start.x < 15 && test.start.y < 10) {
        visualizePath(test.start, test.end, path, test.obstacles);
      }
    }
  }

  console.log('\n==========================================');
  console.log('TEST SUMMARY');
  console.log('==========================================');
  console.log(`Total: ${testCases.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('==========================================\n');

  return failed === 0;
}

// Interactive test - make agent walk to a specific coordinate
function interactiveTest() {
  console.log('\n==========================================');
  console.log('INTERACTIVE PATHFINDING TEST');
  console.log('==========================================\n');

  // Example: Make an agent at (5, 20) walk to (30, 25)
  const agentPos = { x: 5, y: 20 };
  const targetPos = { x: 30, y: 25 };
  const dynamicObstacles = new Set<string>(); // No other entities in the way

  console.log(`Agent at: (${agentPos.x}, ${agentPos.y})`);
  console.log(`Target: (${targetPos.x}, ${targetPos.y})`);
  console.log('Finding path...\n');

  const path = findPath(MAIN_MAP, agentPos, targetPos, dynamicObstacles);

  if (path) {
    console.log('✅ Path found!');
    console.log(`Path length: ${path.length} steps\n`);
    console.log('Full path:');
    console.log(`  Start: (${agentPos.x}, ${agentPos.y})`);
    path.forEach((step, i) => {
      console.log(`  Step ${i + 1}: (${step.x}, ${step.y})`);
    });
    console.log(`  End: (${targetPos.x}, ${targetPos.y})`);

    // Calculate directions for each step
    console.log('\nMovement directions:');
    let current = agentPos;
    path.forEach((step, i) => {
      const dx = step.x - current.x;
      const dy = step.y - current.y;
      let direction = '';
      if (dx > 0) direction = 'RIGHT';
      else if (dx < 0) direction = 'LEFT';
      else if (dy > 0) direction = 'DOWN';
      else if (dy < 0) direction = 'UP';
      console.log(`  Step ${i + 1}: Move ${direction} to (${step.x}, ${step.y})`);
      current = step;
    });

  } else {
    console.log('❌ No path found!');
    console.log('The target may be blocked by walls or out of bounds.');
  }

  console.log('\n==========================================\n');
}

// Run both tests
const allTestsPassed = runTests();
interactiveTest();

if (!allTestsPassed) {
  process.exit(1);
}
