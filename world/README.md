# World Engine

A shared TypeScript library that defines the core game logic, data structures, and simulation rules. This package is **dependency-free** and ensures deterministic, collision-aware gameplay.

## 🎯 Purpose

The `world/` module is the **single source of truth** for game mechanics. It's used by the `realtime-server` to:
- Validate player actions (movement, direction changes)
- Detect collisions between entities
- Simulate AI robot pathfinding with advanced deadlock resolution
- Manage complex multi-entity interactions like the Conversation System
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
```

**Key Features in `tick()`:**
- **Reservation Table:** Resolves movement conflicts when multiple entities want to move to the same spot.
- **Deadlock Detection:** Detects if entities are stuck in loops or oscillating and applies "unstuck" logic.
- **Conversation Proximity:** Automatically detects when entities walking toward each other for a conversation have arrived.

### `entities/` - Entity Definitions

All entities are **2x2 grid units** and have these properties:

```typescript
interface Entity {
  entityId: string;
  kind: 'PLAYER' | 'ROBOT' | 'WALL';
  displayName: string;
  x: number;
  y: number;
  color?: string;
  facing?: { x: 0|1|-1, y: 0|1|-1 };
  conversationState: 'IDLE' | 'PENDING_REQUEST' | 'WALKING_TO_CONVERSATION' | 'IN_CONVERSATION';
  // ... pathfinding & conversation metadata
}
```

### 🗣️ Conversation System

The engine implements a state-machine based conversation system:

1. **`requestConversation(initiator, target)`**: Checks range and availability.
2. **`acceptConversation(target, requestId)`**: Initiator starts pathfinding toward the target.
3. **`WALKING_TO_CONVERSATION`**: The engine handles navigation until they are adjacent.
4. **`IN_CONVERSATION`**: Entities face each other and stop moving.
5. **`endConversation(entityId)`**: Resets both participants to `IDLE`.

### 🚀 Advanced Utilities

- **`utils/reservations.ts`**: Implements a priority-based reservation system to prevent entity overlapping during simultaneous movement.
- **`utils/pathfinding.ts`**: BFS-based pathfinding with support for large obstacles.
- **`utils/conversation.ts`**: Manages request lifecycles, timeouts, and adjacency math.
- **`utils/flowfield.ts`**: (Experimental) Vector field based navigation for many-agent scaling.
- **`utils/whca.ts`**: (Experimental) Windowed Hierarchical Cooperative A* for advanced multi-agent pathfinding.

## 🔄 Game Loop Flow

**Server calls `world.tick()` every 100ms:**

1. **Planning:** Entities with targets (Robots or Players in conversation) plan their next move.
2. **Conflict Resolution:** `ReservationTable` approves or rejects proposed moves based on priority and availability.
3. **Execution:** Approved moves are applied; rejected entities may trigger "unstuck" random movement.
4. **Interactions:** Conversation proximity is checked, and state transitions are applied.
5. **Events:** All changes (moves, turns, state changes) are returned as a flat list of events.

## 🧪 Testing

The engine can be run in any JS/TS environment:
```bash
# Example: Using ts-node or vitest
npx vitest run world/
```

## 📚 Design Principles

1. **Determinism:** Same inputs always produce same outputs.
2. **Immutability:** Internal state updates follow immutable patterns where possible.
3. **No Side Effects:** Pure logic; no I/O or network calls.
4. **Scalability:** Utilities like `ReservationTable` and `FlowFields` allow for hundreds of active entities.