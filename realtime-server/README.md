# Realtime Game Server

A Node.js WebSocket server that powers the multiplayer experience. It manages the game world simulation, handles client connections, and orchestrates AI control for disconnected players.

## 🛠 Tech Stack
- **Runtime:** Node.js (TypeScript)
- **WebSockets:** `ws` library
- **Database:** Supabase (for User Positions & Auth verification)
- **Game Engine:** Custom engine imported from `../world`

## 📂 Structure
- `src/index.ts`: Entry point. Sets up WebSocket servers and loops.
- `src/game.ts`: Manages the `World` instance, Game Loop (200ms), and AI Loop (1000ms).
- `src/handlers.ts`: WebSocket event handlers (`join`, `move`, `disconnect`). Contains logic for **AI Takeover** on disconnect.
- `src/state.ts`: In-memory state maps for active clients and connections.
- `src/db.ts`: Supabase client and persistence logic.

## 🧠 Key Concepts

### AI Takeover System
1.  **Disconnect:** When a player closes their connection, their `PLAYER` entity is **not removed**. Instead, it is converted into a `ROBOT` entity.
2.  **AI Loop:** The server creates a separate loop that scans for `ROBOT` entities. It queries the Python API (`http://localhost:3003/agent/decision`) to determine where they should move.
3.  **Rejoin:** When the user logs back in, the server detects the existing `ROBOT` entity, removes it, and spawns the player at the robot's last known location, restoring control.

### Architecture
- **Play Server (Port 3001):** Handles interactive client sessions.
- **Watch Server (Port 3002):** Read-only stream for spectators (optional).
- **Source of Truth:**
    - **Identity/Auth:** Supabase.
    - **Position:** Supabase `user_positions` table (persisted on disconnect/connect).
    - **Live State:** In-memory `World` class.

## 🚀 Usage

### Setup
Create a `.env` file:
```env
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

### Run
```bash
npm install
npm start
```
