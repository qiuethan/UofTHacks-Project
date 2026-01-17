# UofTHacks 2026 Project: Avatar World

A multiplayer virtual world where users can create avatars, move around in real-time, and have their avatars taken over by AI when they go offline.

## 🏗 Architecture

The project consists of four main components:

1.  **`web/`**: A React-based frontend for the user interface, handling authentication, avatar creation, and the game view.
2.  **`realtime-server/`**: A Node.js WebSocket server that manages the game state, handles real-time player movement, and coordinates AI control for offline players.
3.  **`api/`**: A Python FastAPI backend responsible for avatar metadata storage (SQLite), sprite management (via Supabase Storage), and providing AI decision logic.
4.  **`world/`**: A shared TypeScript library containing the core game engine, entity definitions, and logic used by the realtime server.
5.  **`supabase/`**: Handles Authentication, persistent User Position data, and Object Storage for sprites.

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)
- Supabase Account (for Auth, DB, & Storage)

### 1. Setup Environment Variables
Ensure you have `.env` files in `realtime-server/`, `api/`, and `web/` with your Supabase credentials:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY` (for servers) / `VITE_SUPABASE_ANON_KEY` (for web)

### 2. Install Dependencies & Run

**Terminal 1: Realtime Server**
```bash
cd realtime-server
npm install
npm start
```

**Terminal 2: API**
```bash
cd api
# Create venv if needed: python -m venv venv
.\venv\Scripts\activate # or source venv/bin/activate
pip install -r requirements.txt
python -m app.main
```

**Terminal 3: Frontend**
```bash
cd web
npm install
npm run dev
```

## 🎮 Features
- **Real-time Multiplayer:** See other players move in real-time.
- **Persistent Avatars:** Custom names and colors.
- **AI Takeover:** When a player disconnects, their avatar remains in the world and is controlled by an AI agent (Random Walk).
- **Seamless Rejoin:** When a player reconnects, they immediately regain control of their avatar from the AI.