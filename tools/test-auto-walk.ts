/**
 * AUTOMATED WALK TEST
 * 
 * This script demonstrates how to make an agent automatically walk to coordinates.
 * It simulates the pathfinding and movement logic used in the game.
 */

import { findPath } from '../world/utils/pathfinding';
import { MAIN_MAP } from '../world/map/index';

interface Point {
  x: number;
  y: number;
}

function simulateAgentWalk(start: Point, target: Point, obstacles: Set<string> = new Set()) {
  console.log('==========================================');
  console.log('AUTOMATED AGENT WALK SIMULATION');
  console.log('==========================================\n');
  
  console.log(`🤖 Agent starting at: (${start.x}, ${start.y})`);
  console.log(`🎯 Target destination: (${target.x}, ${target.y})`);
  console.log(`📏 Straight-line distance: ${Math.abs(target.x - start.x) + Math.abs(target.y - start.y)} tiles\n`);
  
  // Step 1: Find path
  console.log('Step 1: Finding path...');
  const path = findPath(MAIN_MAP, start, target, obstacles);
  
  if (!path) {
    console.log('❌ No path found! Target may be:');
    console.log('   - Blocked by walls');
    console.log('   - Unreachable due to obstacles');
    console.log('   - Out of map bounds\n');
    return;
  }
  
  console.log(`✅ Path found! ${path.length} steps required\n`);
  
  // Step 2: Simulate movement
  console.log('Step 2: Simulating agent movement...\n');
  console.log('Time | Position    | Direction | Status');
  console.log('-----|-------------|-----------|--------');
  
  let current = start;
  let timeStep = 0;
  
  // Initial position
  console.log(`${timeStep.toString().padStart(4, ' ')} | (${current.x.toString().padStart(2, ' ')}, ${current.y.toString().padStart(2, ' ')})    | START     | 🟢`);
  
  for (let i = 0; i < path.length; i++) {
    const next = path[i];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    
    let direction = '';
    let arrow = '';
    if (dx > 0) { direction = 'RIGHT'; arrow = '→'; }
    else if (dx < 0) { direction = 'LEFT'; arrow = '←'; }
    else if (dy > 0) { direction = 'DOWN'; arrow = '↓'; }
    else if (dy < 0) { direction = 'UP'; arrow = '↑'; }
    
    timeStep++;
    const status = i === path.length - 1 ? '🎯 ARRIVED' : arrow;
    console.log(`${timeStep.toString().padStart(4, ' ')} | (${next.x.toString().padStart(2, ' ')}, ${next.y.toString().padStart(2, ' ')})    | ${direction.padEnd(9, ' ')} | ${status}`);
    
    current = next;
  }
  
  console.log('\n✅ Agent successfully reached target!\n');
  
  // Step 3: Show how this works in the game
  console.log('==========================================');
  console.log('HOW THIS WORKS IN THE GAME');
  console.log('==========================================\n');
  
  console.log('1. AI Loop (1Hz) in realtime-server/src/game.ts:');
  console.log('   - Checks all ROBOT entities');
  console.log('   - Calls Python API for decision making');
  console.log('   - API uses findPath() to get route\n');
  
  console.log('2. Game Loop (10Hz) in realtime-server/src/game.ts:');
  console.log('   - Processes movement for all entities');
  console.log('   - Moves entities along their path');
  console.log('   - Broadcasts updates to all clients\n');
  
  console.log('3. Client (web/src/pages/GameView.tsx):');
  console.log('   - Receives position updates via WebSocket');
  console.log('   - Renders entity movement on canvas');
  console.log('   - Shows smooth transitions\n');
}

// Example usage with different scenarios
console.log('\n');
console.log('═════════════════════════════════════════');
console.log('  PATHFINDING TEST SCENARIOS');
console.log('═════════════════════════════════════════\n');

// Test 1: Simple horizontal walk
console.log('TEST 1: Simple horizontal walk\n');
simulateAgentWalk(
  { x: 19, y: 0 },
  { x: 25, y: 0 }
);

// Test 2: Walk with turn
console.log('\n\n');
console.log('TEST 2: Walk with a turn\n');
simulateAgentWalk(
  { x: 0, y: 16 },
  { x: 5, y: 20 }
);

// Test 3: Longer path
console.log('\n\n');
console.log('TEST 3: Longer distance path\n');
simulateAgentWalk(
  { x: 19, y: 0 },
  { x: 38, y: 0 }
);

console.log('\n═════════════════════════════════════════');
console.log('  HOW TO TEST LIVE IN-GAME');
console.log('═════════════════════════════════════════\n');

console.log('Option 1: Using AI (automatic):');
console.log('  1. Start realtime-server and web client');
console.log('  2. Join as a player and move somewhere');
console.log('  3. Close the browser tab (disconnect)');
console.log('  4. Your player becomes a ROBOT');
console.log('  5. AI will control it and use pathfinding\n');

console.log('Option 2: Manually test (for debugging):');
console.log('  1. Open realtime-server/src/game.ts');
console.log('  2. Find the AI loop (search for "AI LOOP")');
console.log('  3. Add this code to force a robot to walk:\n');

console.log('```typescript');
console.log('// Force robot to walk to specific coordinate');
console.log('const testRobot = world.entities.find(e => e.type === "ROBOT");');
console.log('if (testRobot && !testRobot.targetPosition) {');
console.log('  const path = findPath(');
console.log('    MAIN_MAP,');
console.log('    testRobot.position[0],');
console.log('    { x: 30, y: 20 }, // Your target coordinate');
console.log('    getObstacleSet(world)');
console.log('  );');
console.log('  if (path) {');
console.log('    testRobot.targetPosition = { x: 30, y: 20 };');
console.log('    testRobot.path = path;');
console.log('    console.log(`Robot will walk ${path.length} steps`);');
console.log('  }');
console.log('}');
console.log('```\n');

console.log('  4. Restart the server');
console.log('  5. Watch the robot automatically navigate!\n');

console.log('═════════════════════════════════════════\n');
console.log('✅ Pathfinding test complete!\n');
