# Pathfinding Test Tools

This directory contains tools to test and visualize the pathfinding system used in the game.

## Quick Test Commands

Run from the `realtime-server` directory:

```bash
cd realtime-server

# Run comprehensive pathfinding tests
npx tsx ../tools/test-pathfinding-real.ts

# Simulate automated agent walking
npx tsx ../tools/test-auto-walk.ts

# Check collision data at specific positions
npx tsx ../tools/check-collision-at-pos.ts
```

## Test Files

### 1. `test-auto-walk.ts` ✅ RECOMMENDED
**Best for:** Seeing how an agent walks from point A to B

Shows a step-by-step simulation of an agent walking to a target coordinate:
- Finds optimal path using BFS
- Displays movement sequence with directions (UP/DOWN/LEFT/RIGHT)
- Shows how many steps it takes
- Includes examples of different scenarios

**Example output:**
```
Time | Position    | Direction | Status
-----|-------------|-----------|--------
   0 | (19,  0)    | START     | 🟢
   1 | (20,  0)    | RIGHT     | →
   2 | (21,  0)    | RIGHT     | →
   3 | (22,  0)    | RIGHT     | →
```

### 2. `test-pathfinding-real.ts`
**Best for:** Verifying pathfinding works correctly

Runs automated test suite with various scenarios:
- Short, medium, and long distance paths
- Paths with obstacles
- Edge cases and boundary conditions

### 3. `check-collision-at-pos.ts`
**Best for:** Debugging why a path isn't working

Checks if specific coordinates are blocked by walls:
- Shows collision status for individual tiles
- Verifies 2x1 entity placement validity
- Finds open areas on the map

## How Pathfinding Works

### Entity Size
All entities in the game are **2x1** (width 2, height 1 tile):
```
██  <- Entity occupies 2 horizontal tiles
```

### Algorithm
- Uses **BFS (Breadth-First Search)** for optimal shortest path
- Checks collision with:
  - Static walls (from Tiled map collision data)
  - Dynamic obstacles (other entities)
  - Map boundaries

### Integration with Game

1. **AI Loop (1Hz)** - `realtime-server/src/game.ts`
   - Robots decide where to move
   - Calls `findPath()` to get route

2. **Game Loop (10Hz)** - `realtime-server/src/game.ts`
   - Moves entities along their path
   - One step per tick

3. **Client Updates** - `web/src/pages/GameView.tsx`
   - Receives position updates via WebSocket
   - Renders smooth movement

## Testing In-Game

### Option 1: Automatic (via AI)
1. Start `realtime-server` and `web` client
2. Join the game as a player
3. Disconnect (close browser)
4. Your player becomes a ROBOT
5. AI takes over and uses pathfinding

### Option 2: Manual (for debugging)
1. Open `realtime-server/src/game.ts`
2. Find the AI loop (search for "AI LOOP")
3. Add code to force a robot to walk:

```typescript
// Add this in the AI loop
const testRobot = world.entities.find(e => e.type === "ROBOT");
if (testRobot && !testRobot.targetPosition) {
  const path = findPath(
    MAIN_MAP,
    testRobot.position[0],
    { x: 30, y: 20 }, // Target coordinate
    getObstacleSet(world)
  );
  if (path) {
    testRobot.targetPosition = { x: 30, y: 20 };
    testRobot.path = path;
    console.log(`Robot walking ${path.length} steps to target`);
  }
}
```

4. Restart the server
5. Watch the robot navigate!

## Common Issues

### "No path found"
**Causes:**
- Target is blocked by walls (check with `check-collision-at-pos.ts`)
- Target is out of bounds (x must be 0-58, y must be 0-39 for 2x1 entities)
- Dynamic obstacles are blocking all routes

**Solutions:**
- Use `check-collision-at-pos.ts` to verify target is walkable
- Try different coordinates
- Remove obstacles

### Path seems inefficient
- BFS always finds the **shortest** path (by number of steps)
- Path may look indirect due to wall placement
- This is expected behavior

## Map Information

- **Size:** 60x40 tiles (grid)
- **Pixel size:** 960x640 pixels (16px per tile)
- **Collision data:** Auto-generated from `web/public/assets/tiled/map16x16.tmj`
- **Regenerate collision:** Run `node tools/process-tiled-map.js`

## Good Test Coordinates

These coordinates are verified to be open (walkable):

**Starting positions:**
- (19, 0) - Top of map, open area
- (0, 16) - Left side, middle height
- (5, 20) - Central area

**Target positions:**
- (25, 0) - Top of map, right side
- (38, 0) - Far right, top
- (5, 20) - Central area

**Long distance test:**
- Start: (19, 0)
- End: (38, 0)
- Expected: ~19 steps

## Source Code

**Pathfinding implementation:**
- `world/utils/pathfinding.ts` - Core BFS algorithm

**Map & collision:**
- `world/map/index.ts` - Map definition
- `world/map/collisionData.ts` - Collision grid (auto-generated)
- `world/map/mapDef.ts` - Map utilities

**Game integration:**
- `realtime-server/src/game.ts` - Game loop and AI loop
- `api/app/agent_worker.py` - AI decision making (uses pathfinding)
