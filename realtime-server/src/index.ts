import { WebSocketServer } from 'ws';
import { PLAY_PORT, WATCH_PORT } from './config';
import { startGameLoop, startAiLoop, world } from './game';
import { generateOrderId, generateWatcherId, spectators } from './state';
import { handleJoin, handleSetDirection, handleDisconnect } from './handlers';
import { send } from './network';
import type { ClientMessage, Client } from './types';

// Start loops
startGameLoop();
startAiLoop();

// ============================================================================
// PLAY WEBSOCKET SERVER (port 3001)
// ============================================================================

const playWss = new WebSocketServer({ port: PLAY_PORT });

console.log(`Play server running on ws://localhost:${PLAY_PORT}`);

playWss.on('connection', (ws) => {
  const oderId = generateOrderId();
  let client: Client | null = null;

  ws.on('message', async (data) => {
    try {
      const msg: ClientMessage = JSON.parse(data.toString());
      
      if (msg.type === 'JOIN') {
        client = await handleJoin(ws, oderId, msg);
      } else if (msg.type === 'SET_DIRECTION' && client) {
        await handleSetDirection(client, msg.dx ?? 0, msg.dy ?? 0);
      }
    } catch (e) {
      send(ws, { type: 'ERROR', error: 'Invalid message format' });
    }
  });

  ws.on('close', async () => {
    if (client) {
      await handleDisconnect(client, oderId);
    } else {
        // Just a clean up if join never succeeded
    }
  });
});

// ============================================================================
// WATCH WEBSOCKET SERVER (port 3002)
// ============================================================================

const watchWss = new WebSocketServer({ port: WATCH_PORT });

console.log(`Watch server running on ws://localhost:${WATCH_PORT}`);

watchWss.on('connection', (ws) => {
  const watcherId = generateWatcherId();
  spectators.add(ws);
  console.log(`Spectator connected: ${watcherId}`);
  
  // Send current world state
  send(ws, { type: 'SNAPSHOT', snapshot: world.getSnapshot() });
  
  ws.on('close', () => {
    spectators.delete(ws);
    console.log(`Spectator disconnected: ${watcherId}`);
  });
});