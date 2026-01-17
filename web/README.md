# Frontend Client

A React application built with Vite that serves as the entry point for users.

## 🛠 Tech Stack
- **Framework:** React + TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **Auth:** Supabase Auth Helpers

## 📂 Key Components
- `src/pages/GameView.tsx`: The main game canvas. Connects to the WebSocket server (`ws://localhost:3001`), renders the grid, and handles keyboard input.
- `src/components/Grid.tsx`: Visualizes the game state received from the server.
- `src/contexts/AuthContext.tsx`: Manages user login state.
- `src/lib/supabase.ts`: Client-side Supabase configuration.

## 🎮 How it Works
1.  **Login:** Users authenticate via Supabase.
2.  **Connect:** On entering `GameView`, the client opens a WebSocket connection, sending the Auth Token.
3.  **Sync:** The client receives a `SNAPSHOT` of the world initially, and then delta `EVENTS` (e.g., entity moved, joined) to update the local view.
4.  **Input:** Arrow keys send `SET_DIRECTION` messages to the server.

## 🚀 Usage

### Setup
Create a `.env` file:
```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### Run
```bash
npm install
npm run dev
```
