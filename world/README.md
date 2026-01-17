# World Engine

A shared TypeScript library that defines the core game logic, data structures, and simulation rules. This package is **dependency-free** and ensures deterministic, collision-aware gameplay.

## 🎯 Purpose

The `world/` module is the **single source of truth** for game mechanics. It's used by the `realtime-server` to:
- Validate player actions (movement, direction changes)
- Detect collisions between entities
- Simulate AI robot pathfinding
- Maintain consistent game state across all clients

## 📦 Module Structure

### `engine/world.ts` - Core Simulation

**`World` class** - Main game container

```typescript
const world = new World(createMapDef(20, 15));

// Add entities
world.addEntity(createAvatar('user-123', 'Alice', 5, 5));
world.addEntity(createWall('wall-1', 10, 10));

// Process player input
world.submitAction('user-123', { type: 'SET_DIRECTION', dx: 1, dy: 0 });

// Advance simulation (called every 100ms by server)
const events = world.tick();
// Returns: [{ type: 'ENTITY_MOVED', entityId: 'user-123', x: 6, y: 5 }]
```

**Key Methods:**
- `addEntity(entity)` - Spawn a new entity (player, robot, wall)
- `removeEntity(entityId)` - Despawn an entity
- `submitAction(entityId, action)` - Validate and apply player actions
- `tick()` - Advance simulation by one frame (processes movement, AI)
- `getSnapshot()` - Get current world state for broadcasting
- `setEntityTarget(entityId, {x, y})` - Set AI target for robots

### `entities/` - Entity Definitions

All entities are **2x2 grid units** and have these properties:

```typescript
interface Entity {
  entityId: string;           // Unique identifier
  kind: 'PLAYER' | 'ROBOT' | 'WALL';
  displayName: string;
  x: number;                  // Top-left corner position
  y: number;
  color?: string;             // Hex color (e.g., '#ff0000')
  facing?: { x: 0|1|-1, y: 0|1|-1 };  // Direction indicator
  direction?: { x: 0|1|-1, y: 0|1|-1 }; // Current movement intent
  targetPosition?: { x: number, y: number }; // AI target (robots only)
}
```

**Factory Functions:**
- `createAvatar(id, name, x, y, facing?)` - Creates a PLAYER entity
- `createRobot(id, x, y)` - Creates a ROBOT entity (red color)
- `createWall(id, x, y)` - Creates a WALL entity (black)

### `actions/` - Action Pipeline

All state changes go through a **validate → apply** pipeline:

#### Action Types

**`SET_DIRECTION`** - Change movement direction (used by players)
```typescript
{ type: 'SET_DIRECTION', dx: 1, dy: 0 }  // Move right
```
- Only allows single-axis movement (no diagonals)
- Updates `entity.direction` and `entity.facing`
- Emits `ENTITY_TURNED` event if facing changed

**`MOVE`** - Teleport to position (used internally by tick())
```typescript
{ type: 'MOVE', x: 10, y: 5 }
```
- Validates collision with all entities
- Clamps to map bounds
- Emits `ENTITY_MOVED` event on success

#### Collision Detection

2x2 entities overlap if:
```typescript
Math.abs(entityA.x - entityB.x) < 2 && Math.abs(entityA.y - entityB.y) < 2
```

Movement is **blocked** if collision detected with any entity (PLAYER, ROBOT, or WALL).

### `utils/pathfinding.ts` - BFS Pathfinding

```typescript
findPath(
  map: MapDef,
  start: { x: number, y: number },
  goal: { x: number, y: number },
  obstacles: Set<string>  // e.g., Set(['10,5', '10,6'])
): { x: number, y: number }[] | null
```

- Returns array of positions from start to goal (excluding start)
- Returns `null` if no path exists
- Used by robots to navigate around obstacles

### `map/mapDef.ts` - Grid Utilities

```typescript
interface MapDef {
  width: number;   // Grid width (e.g., 20)
  height: number;  // Grid height (e.g., 15)
}

createMapDef(width, height)  // Factory
isInBounds(map, x, y)        // Check if position valid
clampToBounds(map, x, y)     // Force position into bounds
```

## 🔄 Game Loop Flow

**Server calls `world.tick()` every 100ms:**

1. **Build obstacle map** - All entities become obstacles for pathfinding
2. **Robot AI** - For each robot:
   - If has `targetPosition`, calculate path using BFS
   - Set `direction` to next step in path
   - Emit `ENTITY_TURNED` if facing changed
3. **Movement** - For each entity with non-zero `direction`:
   - Calculate target position: `(x + direction.x, y + direction.y)`
   - Submit `MOVE` action (validates collision)
   - Emit `ENTITY_MOVED` if successful
4. **Return events** - All events are broadcast to clients

## 🧪 Testing

The world engine is designed to be testable in isolation:

```typescript
import { World, createMapDef, createAvatar } from './world';

const world = new World(createMapDef(10, 10));
world.addEntity(createAvatar('player1', 'Alice', 5, 5));

const result = world.submitAction('player1', {
  type: 'SET_DIRECTION',
  dx: 1,
  dy: 0
});

if (result.ok) {
  console.log('Events:', result.value);
}
```

## 🤝 Contributing to World Engine

### Adding New Entity Types

1. Add to `entities/entity.ts`:
```typescript
export type EntityKind = 'PLAYER' | 'ROBOT' | 'WALL' | 'NPC';
```

2. Create factory in `entities/`:
```typescript
export function createNPC(id: string, x: number, y: number): Entity {
  return createEntity(id, 'NPC', 'NPC', x, y, '#00ff00');
}
```

3. Update collision logic in `actions/pipeline.ts` if needed

### Adding New Actions

1. Define type in `actions/types.ts`:
```typescript
export interface InteractAction {
  readonly type: 'INTERACT';
  readonly targetId: string;
}

export type WorldAction = MoveAction | SetDirectionAction | InteractAction;
```

2. Add validation in `actions/pipeline.ts`:
```typescript
case 'INTERACT':
  return validateInteractAction(state, actorId, action.targetId);
```

3. Add application logic:
```typescript
case 'INTERACT':
  return applyInteractAction(state, actor, action.targetId);
```

### Optimization Tips

- **Spatial Hashing:** For large maps, use a grid-based spatial hash instead of iterating all entities
- **Dirty Flags:** Only recalculate paths when obstacles change
- **Event Batching:** Combine multiple events into single broadcast

## 📚 Design Principles

1. **Determinism:** Same inputs always produce same outputs (no `Math.random()` in core logic)
2. **Immutability:** State updates create new objects (enables time travel debugging)
3. **No Side Effects:** World never makes network calls or writes to disk
4. **Type Safety:** Leverage TypeScript for compile-time guarantees
5. **Single Responsibility:** Each module has one clear purpose
