# Realtime Game Server

A Node.js WebSocket server that powers the multiplayer experience. It manages the game world simulation, handles client connections, and orchestrates AI control for disconnected players.

## 🛠 Tech Stack
- **Runtime:** Node.js (TypeScript)
- **WebSockets:** `ws` library (separate servers for play/watch)
- **Database:** Supabase (User Positions & Auth verification)
- **Game Engine:** Custom engine imported from `../world`
- **Build:** `tsx` for TypeScript execution with hot reload

## 📂 File Structure

```
src/
├── index.ts       # WebSocket server setup (play + watch)
├── game.ts        # World instance, game loop (10Hz), AI loop (1Hz)
├── handlers.ts    # Join, set direction, disconnect handlers
├── network.ts     # Broadcast & send utilities
├── state.ts       # In-memory client tracking
├── db.ts          # Supabase position persistence
├── config.ts      # Port numbers, tick rates, API URLs
└── types.ts       # TypeScript interfaces
```

### Key Files

**`index.ts`** - Entry point
- Creates two WebSocket servers:
  - **Play Server** (port 3001): Authenticated player connections
  - **Watch Server** (port 3002): Spectator connections
- Handles message routing for:
  - `JOIN`, `SET_DIRECTION`
  - `CONVERSATION_REQUEST`, `CONVERSATION_ACCEPT`, `CONVERSATION_REJECT`, `CONVERSATION_END`

**`game.ts`** - Simulation core
- **Game Loop** (100ms): Calls `world.tick()`, broadcasts events
- **AI Loop** (1000ms): 
  - Queries Python API for robot decisions.
  - Sends current robot state, nearby entities, and pending conversation requests to the AI.
  - Processes AI responses: `MOVE`, `STAND_STILL`, `REQUEST_CONVERSATION`, `ACCEPT_CONVERSATION`, `REJECT_CONVERSATION`.

**`handlers.ts`** - Connection & Action logic
- Handles player lifecycle (Join -> Play -> Disconnect -> Robot Takeover).
- Manages conversation state transitions by calling `world` methods and broadcasting results.

**`db.ts`** - Supabase integration
- `getPosition(userId)`: Loads x, y, facing_x, facing_y from DB
- `updatePosition(userId, data)`: Saves position and facing direction
- Creates random spawn position for new users

## 🧠 Key Concepts

### Dual WebSocket Architecture

**Play Server (Port 3001)**
- Requires authentication (Supabase JWT)
- Handles `JOIN` and `SET_DIRECTION` messages
- Validates all actions through game engine
- Saves position to DB on every direction change

**Watch Server (Port 3002)**
- No authentication required
- Immediately sends `SNAPSHOT` on connection
- Receives same `EVENTS` broadcast as play clients
- Read-only (ignores any client messages)

### AI Takeover System

**On Disconnect:**
1. Player's WebSocket closes
2. Current position saved to Supabase
3. `PLAYER` entity converted to `ROBOT` entity (red color)
4. Entity remains in world, visible to all clients

**AI Loop (1Hz):**
1. Scans for all `ROBOT` entities
2. For robots without `targetPosition`:
   - Sends `POST /agent/decision` to Python API
   - Receives random target coordinates
   - Sets `robot.targetPosition`
3. Game loop handles pathfinding and movement

**On Rejoin:**
1. Server detects existing `ROBOT` with same userId
2. Removes robot entity
3. Spawns `PLAYER` at robot's last position
4. Player regains control immediately

### Collision System

All entities are **2x2 grid units** and block each other:
- Players cannot move through other players
- Players cannot move through robots
- Robots pathfind around all obstacles (players, robots, walls)
- Movement is validated server-side (client cannot cheat)

### Data Flow

```
Client Input (WASD)
  ↓
SET_DIRECTION message
  ↓
Server validates & updates entity.direction
  ↓
Saved to Supabase (x, y, facing_x, facing_y)
  ↓
Game Loop (10Hz) processes movement
  ↓
Collision detection via world engine
  ↓
ENTITY_MOVED event broadcast
  ↓
All clients update their local state
```

### Source of Truth

- **Identity/Auth:** Supabase Auth
- **Persistent Position:** Supabase `user_positions` table
- **Live State:** In-memory `World` class
- **Game Rules:** `../world` engine (deterministic)

## 🚀 Usage

### Setup
Create a `.env` file:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

> **Important:** Use the **service role key**, not the anon key. This allows server-side auth verification.

### Run
```bash
npm install
npm run dev  # Hot reload with tsx
# or
npm start    # Production mode
```

Servers start on:
- Play: `ws://localhost:3001`
- Watch: `ws://localhost:3002`

### Logs

```
Play server running on ws://localhost:3001
Watch server running on ws://localhost:3002
Player joined: Alice (user-123) at (5, 7)
Spectator connected: watcher-1
Client disconnected: user-123
Converted user-123 to robot
```

## 🤝 Contributing

### Adding New Message Types

1. Define in `types.ts`:
```typescript
interface ClientMessage {
  type: 'JOIN' | 'SET_DIRECTION' | 'CHAT';
  // ... existing fields
  message?: string;
}
```

2. Handle in `index.ts`:
```typescript
else if (msg.type === 'CHAT' && client) {
  broadcast({ type: 'CHAT', from: client.displayName, message: msg.message });
}
```

### Optimizing for Scale

**Current limits:**
- ~100 concurrent players (single process)
- 20x15 map (300 cells)
- 10Hz tick rate

**Scaling strategies:**
- Use spatial hashing for collision detection
- Implement room/instance system
- Add Redis for distributed state
- Use worker threads for AI calculations

### Debugging

**Enable verbose logging:**
```typescript
// In game.ts
console.log('Tick:', events);
```

**Test collision:**
```typescript
// In game.ts, add test walls
world.addEntity(createWall('test', 5, 5));
```

**Monitor WebSocket connections:**
```bash
netstat -ano | findstr :3001
```
