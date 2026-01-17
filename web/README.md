# Frontend Client

A React application built with Vite that serves as the entry point for users. Provides both interactive gameplay and spectator modes.

## 🛠 Tech Stack
- **Framework:** React + TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS
- **Auth:** Supabase Auth Helpers
- **WebSockets:** Native WebSocket API

## 📂 Key Components

### Pages
- **`src/pages/GameView.tsx`** - Interactive game mode
  - Connects to Play WebSocket (`ws://localhost:3001`)
  - Requires authentication
  - Handles WASD/Arrow key input
  - Sends `SET_DIRECTION` messages to server
  - Displays facing direction with arrow indicators
  
- **`src/pages/WatchView.tsx`** - Spectator mode
  - Connects to Watch WebSocket (`ws://localhost:3002`)
  - No authentication required
  - Read-only view of the world
  - Shows entity count and debug logs

### Components
- **`src/components/Grid.tsx`** - Renders the game grid (16px cells)
- **`src/components/Cell.tsx`** - Individual grid cell (white background)
- **`src/components/EntityDot.tsx`** - 2x2 entity visualization with facing arrows
- **`src/components/ConversationUI.tsx`** - Overlay for managing conversation requests and active chats
- **`src/components/ConnectionStatus.tsx`** - WebSocket connection indicator

### Contexts & Utils
- **`src/contexts/AuthContext.tsx`** - Manages Supabase login state
- **`src/lib/supabase.ts`** - Client-side Supabase configuration

## 🎮 How it Works

### Play Mode (`/play`)
1. **Login:** Users authenticate via Supabase (email/password)
2. **Connect:** Client opens WebSocket to port 3001, sends auth token
3. **Join:** Server validates token, spawns player at saved position
4. **Sync:** Client receives `SNAPSHOT` initially, then `EVENTS` for updates
5. **Input:** 
   - Key down: Add to pressed keys stack, send `SET_DIRECTION`
   - Key up: Remove from stack, send updated direction
   - Server tick (10Hz): Processes movement based on current direction
6. **Render:** Entities displayed as colored circles with directional arrows

### Watch Mode (`/watch`)
1. **Connect:** Client opens WebSocket to port 3002 (no auth)
2. **Snapshot:** Receives full world state immediately
3. **Updates:** Receives `EVENTS` broadcast from play server
4. **Render:** Same visualization as play mode, but no input handling

## 🔄 Event Handling

The client handles these server events:

- **`SNAPSHOT`** - Full world state (map + all entities)
- **`EVENTS`** - Array of world events:
  - `ENTITY_JOINED` / `ENTITY_LEFT` / `ENTITY_MOVED` / `ENTITY_TURNED`
  - `ENTITY_STATE_CHANGED` - State updates (e.g., entering conversation)
  - `CONVERSATION_REQUESTED` - Incoming request from another entity
  - `CONVERSATION_STARTED` / `CONVERSATION_ENDED`
  - `CONVERSATION_ACCEPTED` / `CONVERSATION_REJECTED`
- **`ERROR`** - Server-side error message
- **`WELCOME`** - Successful join confirmation (play mode only)

## 🚀 Usage

### Setup
Create a `.env` file:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

### Run
```bash
npm install
npm run dev
```

App runs on http://localhost:3000

### Routes
- `/` - Redirects to `/watch`
- `/play` - Interactive game (requires login)
- `/watch` - Spectator mode (no login)
- `/login` - Authentication page

## 🤝 Contributing

### Adding New UI Features

**Display player names:**
```typescript
// In GameView.tsx or WatchView.tsx
{entityHere && (
  <>
    <EntityDot {...props} />
    <span className="text-xs">{entityHere.displayName}</span>
  </>
)}
```

**Add chat system:**
1. Create `src/components/ChatBox.tsx`
2. Add WebSocket message type `CHAT` in server
3. Send messages via `ws.send(JSON.stringify({ type: 'CHAT', message }))`

**Improve styling:**
- Grid is currently 16px cells (see `Grid.tsx`)
- Entities are 2x2 cells with absolute positioning
- TailwindCSS classes can be modified for themes

### Debugging Tips

- **Check WebSocket connection:** Browser DevTools → Network → WS tab
- **View state:** Add `console.log(entities)` in render
- **Test reconnection:** Close/reopen browser tab
- **Simulate lag:** Chrome DevTools → Network → Throttling
