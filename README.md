# UofTHacks 2026 Project: Identity Matrix

A multiplayer virtual world where users can create avatars, move around in real-time, and have their avatars taken over by AI when they go offline.

## 🎯 What This Project Does

- **Real-time Multiplayer:** Multiple players can join the world simultaneously and see each other move in real-time
- **Persistent Avatars:** Player positions and facing directions are saved to Supabase and restored on reconnect
- **AI Takeover:** When a player disconnects, their avatar becomes an AI-controlled robot that continues to exist in the world
- **Spectator Mode:** Watch-only view at `/watch` to observe the world without logging in
- **Collision System:** Players, robots, and walls block each other's movement
- **Directional Movement:** WASD/Arrow keys control movement with visual facing indicators
- **Conversation System:** Players and AI robots can request, accept, and engage in real-time conversations with proximity-based initiation.

## 🏗 Architecture

The project consists of five main components:

### 1. **`web/`** - React Frontend
Handles user authentication, game rendering, and player input. Connects to WebSocket servers for real-time updates.
- **Play Mode** (`/play`): Interactive gameplay (requires login)
- **Watch Mode** (`/watch`): Spectator view (no login required)
- **Tech:** React + TypeScript, Vite, TailwindCSS, Supabase Auth

### 2. **`realtime-server/`** - WebSocket Game Server
Manages the live game simulation, player connections, and AI coordination.
- **Play Server** (port 3001): Handles authenticated player connections
- **Watch Server** (port 3002): Broadcasts world state to spectators
- **Game Loop** (10Hz): Processes movement and collision detection
- **AI Loop** (1Hz): Queries Python API for robot decisions
- **Tech:** Node.js, TypeScript, WebSockets (`ws`), Supabase

### 3. **`api/`** - Python AI & Avatar API
Provides AI decision-making and avatar metadata management.
- **AI Endpoint** (`POST /agent/decision`): Returns movement targets for robots
- **Avatar CRUD**: Create, update, and manage avatar profiles
- **Tech:** FastAPI, SQLite, Supabase Storage

### 4. **`world/`** - Shared Game Engine
Core game logic used by the realtime server. Ensures deterministic, collision-aware simulation.
- **Entity System**: Players, Robots, Walls (all 2x2 grid units)
- **Action Pipeline**: Validates and applies movement/direction changes
- **Pathfinding**: BFS algorithm for robot navigation
- **Tech:** Pure TypeScript (no dependencies)

### 5. **`supabase/`** - Backend Services
- **Authentication**: User login/signup
- **Database**: `user_positions` table stores x, y, facing_x, facing_y
- **Storage**: Avatar sprite images (future feature)

## 🚀 Quick Start

### Prerequisites
- **Node.js** v18+ and npm
- **Python** 3.10+
- **Supabase Account** (free tier works fine)
  - Create a project at [supabase.com](https://supabase.com)
  - Run the migrations in `supabase/migrations/` via the Supabase dashboard SQL editor

### 1. Setup Environment Variables

Create `.env` files in the following directories:

**`realtime-server/.env`**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

**`api/.env`**
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

**`web/.env`**
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

> **Where to find keys:** Supabase Dashboard → Settings → API

### 2. Run the Stack

You need **3 terminals** running simultaneously:

**Terminal 1: Realtime Server** (runs on port 3001 & 3002)
```bash
cd realtime-server
npm install
npm run dev
```

**Terminal 2: Python API** (runs on port 3003)
```bash
cd api
python -m venv venv
.\venv\Scripts\activate  # Windows
# source venv/bin/activate  # Mac/Linux
pip install -r requirements.txt
python -m app.main
```

**Terminal 3: Web Client** (runs on port 3000)
```bash
cd web
npm install
npm run dev
```

### 3. Access the App

- **Play:** http://localhost:3000/play (requires login)
- **Watch:** http://localhost:3000/watch (no login)

### 4. Create an Account

1. Click "Sign Up" on the login page
2. Enter email and password (Supabase handles this)
3. You'll be redirected to the game view
4. Use **WASD** or **Arrow Keys** to move

## 🤝 How to Contribute

### Project Structure Overview

```
UofTHacks-Project/
├── web/                    # React frontend
│   ├── src/pages/         # GameView (play) & WatchView (spectator)
│   ├── src/components/    # Grid, Cell, EntityDot rendering
│   └── src/contexts/      # AuthContext for Supabase login
│
├── realtime-server/        # WebSocket game server
│   ├── src/index.ts       # WebSocket server setup
│   ├── src/game.ts        # Game loop & AI loop
│   ├── src/handlers.ts    # Join, move, disconnect logic
│   └── src/db.ts          # Supabase position persistence
│
├── api/                    # Python FastAPI backend
│   ├── app/main.py        # AI decision endpoint
│   ├── app/database.py    # SQLite avatar storage
│   └── app/models.py      # Pydantic schemas
│
├── world/                  # Shared game engine (TypeScript)
│   ├── engine/world.ts    # World class, tick(), Pathfinding, Conversations
│   ├── actions/           # Movement validation & collision pipeline
│   ├── entities/          # Player, Robot, Wall definitions
│   └── utils/             # Pathfinding, Reservations, Conversations, Flowfields
│
└── supabase/
    └── migrations/         # Database schema (user_positions)
```

### Areas to Contribute

#### 🎨 **Frontend** (`web/`)
- Improve UI/UX (currently minimal styling)
- Add avatar customization UI
- Display player names above entities
- Add minimap or zoom controls
- Implement chat system

#### 🤖 **AI Logic** (`api/app/main.py`)
- Replace random walk with smarter pathfinding
- Add LLM integration for decision-making
- Implement goal-seeking behavior (e.g., patrol, follow player)
- Add personality traits to robots

#### 🎮 **Game Mechanics** (`world/`)
- Add items or collectibles
- Implement different entity types (NPCs, obstacles)
- Add player interactions (trading, combat)
- Create larger, procedurally generated maps

#### 🔧 **Infrastructure** (`realtime-server/`)
- Optimize collision detection for larger maps
- Add server-side anti-cheat validation
- Implement room/instance system for scalability
- Add reconnection resilience

### Development Tips

1. **Testing Multiplayer:** Open multiple browser tabs to `/play` with different accounts
2. **Debugging:** Check browser console (frontend) and terminal logs (servers)
3. **Hot Reload:** All three servers support hot reload during development
4. **Database:** Use Supabase dashboard to inspect `user_positions` table
5. **Ports:** Make sure 3000, 3001, 3002, 3003 are available

### Common Issues

**"EADDRINUSE: address already in use"**
- Kill the process: `netstat -ano | findstr :3001` then `taskkill /PID <PID> /F`

**"Supabase credentials not set"**
- Verify `.env` files exist and have correct keys
- Restart the server after adding `.env`

**"Disconnected-Reconnecting" loop**
- Check that realtime-server is running
- Verify WebSocket URLs in `GameView.tsx` and `WatchView.tsx`

## 📚 Learn More

Each component has its own README with detailed information:
- [`web/README.md`](./web/README.md) - Frontend architecture
- [`realtime-server/README.md`](./realtime-server/README.md) - Server logic & AI takeover
- [`api/README.md`](./api/README.md) - Python API endpoints
- [`world/README.md`](./world/README.md) - Game engine internals