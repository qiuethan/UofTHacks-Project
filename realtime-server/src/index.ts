import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';
import { World, createMapDef, createAvatar } from '../../world/index.ts';
import type { WorldEvent, MoveAction } from '../../world/index.ts';

// ============================================================================
// CONFIG
// ============================================================================

const PLAY_PORT = 3001;
const WATCH_PORT = 3002;
const MAP_WIDTH = 20;
const MAP_HEIGHT = 15;

// Supabase config
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Supabase credentials required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================================================
// DATABASE OPERATIONS (Source of Truth)
// ============================================================================

async function getPosition(userId: string): Promise<{ x: number; y: number }> {
  const { data } = await supabase
    .from('user_positions')
    .select('x, y')
    .eq('user_id', userId)
    .single();
  
  if (data) return { x: data.x, y: data.y };
  
  // First time user - create random position
  const x = Math.floor(Math.random() * MAP_WIDTH);
  const y = Math.floor(Math.random() * MAP_HEIGHT);
  await supabase.from('user_positions').insert({ user_id: userId, x, y });
  return { x, y };
}

async function updatePosition(userId: string, x: number, y: number): Promise<void> {
  await supabase
    .from('user_positions')
    .update({ x, y, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
}

// ============================================================================
// WORLD INSTANCE
// ============================================================================

const world = new World(createMapDef(MAP_WIDTH, MAP_HEIGHT));

// ============================================================================
// CLIENT TRACKING
// ============================================================================

interface Client {
  ws: WebSocket;
  oderId: string;
  userId: string;
  displayName: string;
  isReplaced?: boolean;
}

// Map oderId -> Client (oderId = one-time connection ID)
const clients = new Map<string, Client>();
// Map userId -> oderId (for session handover)
const userConnections = new Map<string, string>();
let nextOrderId = 1;

// ============================================================================
// MESSAGE TYPES
// ============================================================================

interface ClientMessage {
  type: 'JOIN' | 'MOVE' | 'WATCH';
  token?: string;
  userId?: string;
  displayName?: string;
  x?: number;
  y?: number;
}

interface ServerMessage {
  type: 'SNAPSHOT' | 'EVENTS' | 'ERROR' | 'WELCOME' | 'KICKED';
  snapshot?: ReturnType<typeof world.getSnapshot>;
  events?: WorldEvent[];
  error?: string;
  entityId?: string;
}

// ============================================================================
// BROADCAST
// ============================================================================

// Spectators (watch-only connections)
const spectators = new Set<WebSocket>();

function broadcast(message: ServerMessage, exclude?: string) {
  const data = JSON.stringify(message);
  // Send to players
  for (const [id, client] of clients) {
    if (id !== exclude && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
  // Send to spectators
  for (const ws of spectators) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// ============================================================================
// PLAY WEBSOCKET SERVER (port 3001)
// ============================================================================

const playWss = new WebSocketServer({ port: PLAY_PORT });

console.log(`Play server running on ws://localhost:${PLAY_PORT}`);

playWss.on('connection', (ws) => {
  const oderId = `conn-${nextOrderId++}`;
  let client: Client | null = null;

  ws.on('message', async (data) => {
    try {
      const msg: ClientMessage = JSON.parse(data.toString());
      
      if (msg.type === 'JOIN') {
        client = await handleJoin(ws, oderId, msg);
      } else if (msg.type === 'MOVE' && client) {
        await handleMove(client, msg.x ?? 0, msg.y ?? 0);
      }
    } catch (e) {
      send(ws, { type: 'ERROR', error: 'Invalid message format' });
    }
  });

  ws.on('close', async () => {
    if (!client) {
      return;
    }

    // If this client was replaced by a new connection, don't remove the entity
    if (client.isReplaced) {
      console.log(`Client replaced: ${client.userId}`);
      clients.delete(oderId);
      return;
    }
    
    console.log(`Client disconnected: ${client.userId}`);
    
    // Save final position to DB
    const entity = world.getSnapshot().entities.find(e => e.entityId === client!.userId);
    if (entity) {
      await updatePosition(client.userId, entity.x, entity.y);
    }
    
    // Remove from world
    const result = world.removeEntity(client.userId);
    if (result.ok) {
      broadcast({ type: 'EVENTS', events: result.value });
    }
    
    // Clean up tracking
    if (userConnections.get(client.userId) === oderId) {
      userConnections.delete(client.userId);
    }
    clients.delete(oderId);
  });
});

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

async function handleJoin(ws: WebSocket, oderId: string, msg: ClientMessage): Promise<Client | null> {
  const { token, userId, displayName = 'Anonymous' } = msg;
  
  if (!token || !userId) {
    send(ws, { type: 'ERROR', error: 'Authentication required' });
    ws.close();
    return null;
  }
  
  // Verify token
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || data.user.id !== userId) {
    send(ws, { type: 'ERROR', error: 'Invalid authentication token' });
    ws.close();
    return null;
  }
  
  // Handle existing connection - Kick old one seamlessly
  const existingOrderId = userConnections.get(userId);
  if (existingOrderId && clients.has(existingOrderId)) {
    const existingClient = clients.get(existingOrderId);
    if (existingClient) {
      console.log(`Duplicate login for ${userId}. Kicking old connection.`);
      existingClient.isReplaced = true; // Prevent "close" handler from removing entity
      send(existingClient.ws, { type: 'ERROR', error: 'New login detected from another location' });
      existingClient.ws.close();
    }
  }
  
  // Create client
  const client: Client = { ws, oderId, userId, displayName };
  clients.set(oderId, client);
  userConnections.set(userId, oderId);
  
  // Get position from DB (source of truth)
  const pos = await getPosition(userId);
  
  // Use userId as entityId for consistency
  const avatar = createAvatar(userId, displayName, pos.x, pos.y);
  const result = world.addEntity(avatar);
  
  if (!result.ok) {
    if (result.error.code === 'ENTITY_EXISTS') {
      // This is fine, entity is already there (seamless handover)
      console.log(`Player rejoined: ${displayName} (${userId})`);
      send(ws, { type: 'WELCOME', entityId: userId });
      send(ws, { type: 'SNAPSHOT', snapshot: world.getSnapshot() });
      return client;
    } else {
      send(ws, { type: 'ERROR', error: result.error.message });
      ws.close();
      return null;
    }
  }
  
  console.log(`Player joined: ${displayName} (${userId}) at (${pos.x}, ${pos.y})`);
  
  send(ws, { type: 'WELCOME', entityId: userId });
  send(ws, { type: 'SNAPSHOT', snapshot: world.getSnapshot() });
  broadcast({ type: 'EVENTS', events: result.value }, oderId);
  
  return client;
}

async function handleMove(client: Client, x: number, y: number): Promise<void> {
  // Update DB first (source of truth)
  await updatePosition(client.userId, x, y);
  
  // Then update world
  const action: MoveAction = { type: 'MOVE', x, y };
  const result = world.submitAction(client.userId, action);
  
  if (!result.ok) {
    send(client.ws, { type: 'ERROR', error: result.error.message });
    return;
  }
  
  broadcast({ type: 'EVENTS', events: result.value });
}

// ============================================================================
// WATCH WEBSOCKET SERVER (port 3002)
// ============================================================================

const watchWss = new WebSocketServer({ port: WATCH_PORT });

console.log(`Watch server running on ws://localhost:${WATCH_PORT}`);

watchWss.on('connection', (ws) => {
  const watcherId = `watcher-${nextOrderId++}`;
  spectators.add(ws);
  console.log(`Spectator connected: ${watcherId}`);
  
  // Send current world state
  send(ws, { type: 'SNAPSHOT', snapshot: world.getSnapshot() });
  
  ws.on('close', () => {
    spectators.delete(ws);
    console.log(`Spectator disconnected: ${watcherId}`);
  });
});
