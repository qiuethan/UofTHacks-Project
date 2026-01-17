import { WebSocketServer, WebSocket } from 'ws';
import { World, createMapDef, createAvatar } from '../../world/index.ts';
import type { WorldEvent, MoveAction } from '../../world/index.ts';

// ============================================================================
// CONFIG
// ============================================================================

const PORT = 3001;
const MAP_WIDTH = 20;
const MAP_HEIGHT = 15;

// ============================================================================
// WORLD INSTANCE
// ============================================================================

const world = new World(createMapDef(MAP_WIDTH, MAP_HEIGHT));

// ============================================================================
// CLIENT TRACKING
// ============================================================================

interface Client {
  ws: WebSocket;
  entityId: string;
}

const clients = new Map<string, Client>();
let nextClientId = 1;

// ============================================================================
// MESSAGE TYPES
// ============================================================================

interface ClientMessage {
  type: 'JOIN' | 'MOVE';
  displayName?: string;
  x?: number;
  y?: number;
}

interface ServerMessage {
  type: 'SNAPSHOT' | 'EVENTS' | 'ERROR' | 'WELCOME';
  snapshot?: ReturnType<typeof world.getSnapshot>;
  events?: WorldEvent[];
  error?: string;
  entityId?: string;
}

// ============================================================================
// BROADCAST
// ============================================================================

function broadcast(message: ServerMessage, exclude?: string) {
  const data = JSON.stringify(message);
  for (const [id, client] of clients) {
    if (id !== exclude && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// ============================================================================
// WEBSOCKET SERVER
// ============================================================================

const wss = new WebSocketServer({ port: PORT });

console.log(`Realtime server running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  const entityId = `player-${nextClientId++}`;
  console.log(`Client connected: ${entityId}`);

  // Store client reference (not yet in world until JOIN)
  const client: Client = { ws, entityId };
  clients.set(entityId, client);

  ws.on('message', (data) => {
    try {
      const msg: ClientMessage = JSON.parse(data.toString());
      handleMessage(client, msg);
    } catch (e) {
      send(ws, { type: 'ERROR', error: 'Invalid message format' });
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${entityId}`);
    
    // Remove from world
    const result = world.removeEntity(entityId);
    if (result.ok) {
      broadcast({ type: 'EVENTS', events: result.value });
    }
    
    clients.delete(entityId);
  });
});

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

function handleMessage(client: Client, msg: ClientMessage) {
  switch (msg.type) {
    case 'JOIN':
      handleJoin(client, msg.displayName || 'Anonymous');
      break;
    case 'MOVE':
      handleMove(client, msg.x ?? 0, msg.y ?? 0);
      break;
    default:
      send(client.ws, { type: 'ERROR', error: 'Unknown message type' });
  }
}

function handleJoin(client: Client, displayName: string) {
  // Spawn at random position
  const x = Math.floor(Math.random() * MAP_WIDTH);
  const y = Math.floor(Math.random() * MAP_HEIGHT);
  
  const avatar = createAvatar(client.entityId, displayName, x, y);
  const result = world.addEntity(avatar);
  
  if (!result.ok) {
    send(client.ws, { type: 'ERROR', error: result.error.message });
    return;
  }
  
  // Send welcome with entityId
  send(client.ws, { type: 'WELCOME', entityId: client.entityId });
  
  // Send current snapshot to new client
  send(client.ws, { type: 'SNAPSHOT', snapshot: world.getSnapshot() });
  
  // Broadcast join event to others
  broadcast({ type: 'EVENTS', events: result.value }, client.entityId);
}

function handleMove(client: Client, x: number, y: number) {
  const action: MoveAction = { type: 'MOVE', x, y };
  const result = world.submitAction(client.entityId, action);
  
  if (!result.ok) {
    send(client.ws, { type: 'ERROR', error: result.error.message });
    return;
  }
  
  // Broadcast move event to all clients (including sender for confirmation)
  broadcast({ type: 'EVENTS', events: result.value });
}
