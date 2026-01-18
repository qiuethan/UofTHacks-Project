import { WebSocketServer } from 'ws';
import { PLAY_PORT, WATCH_PORT } from './config';
import { startGameLoop, startAiLoop, loadExistingUsers, world, startConversationTimeoutLoop, startAgentAgentConversationLoop } from './game';
import { generateOrderId, generateWatcherId, spectators } from './state';
import { handleJoin, handleSetDirection, handleDisconnect, handleRequestConversation, handleAcceptConversation, handleRejectConversation, handleEndConversation, handleChatMessage } from './handlers';
import { send } from './network';
import type { ClientMessage, Client } from './types';

// Initialize the world with existing users, then start loops
async function initialize() {
  // Load all existing users from the database as ROBOTs
  await loadExistingUsers();
  
  // Start game loops
  startGameLoop();
  startAiLoop();
  startConversationTimeoutLoop();
  startAgentAgentConversationLoop();
  
  console.log('Game world initialized with existing users');
}

// Run initialization
initialize().catch(err => {
  console.error('Failed to initialize game world:', err);
  process.exit(1);
});

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
      } else if (msg.type === 'REQUEST_CONVERSATION' && client && msg.targetEntityId) {
        await handleRequestConversation(client, msg.targetEntityId);
      } else if (msg.type === 'ACCEPT_CONVERSATION' && client && msg.requestId) {
        await handleAcceptConversation(client, msg.requestId);
      } else if (msg.type === 'REJECT_CONVERSATION' && client && msg.requestId) {
        await handleRejectConversation(client, msg.requestId);
      } else if (msg.type === 'END_CONVERSATION' && client) {
        await handleEndConversation(client);
      } else if (msg.type === 'CHAT_MESSAGE' && client && msg.content) {
        await handleChatMessage(client, msg.content);
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
  const snapshot = world.getSnapshot();
  
  // Debug: Log entity sprite info
  console.log(`[Watch] Sending snapshot with ${snapshot.entities.length} entities:`);
  snapshot.entities.forEach(e => {
    if (e.kind !== 'WALL') {
      console.log(`  - ${e.displayName} (${e.kind}): sprites=${e.sprites ? 'yes' : 'NO'}`);
    }
  });
  
  send(ws, { type: 'SNAPSHOT', snapshot });
  
  ws.on('close', () => {
    spectators.delete(ws);
    console.log(`Spectator disconnected: ${watcherId}`);
  });
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

function shutdown() {
  console.log('Shutting down servers...');
  
  playWss.close(() => {
    console.log('Play server closed');
  });
  
  watchWss.close(() => {
    console.log('Watch server closed');
  });

  // Force exit if it takes too long
  setTimeout(() => {
    console.error('Forcing shutdown...');
    process.exit(1);
  }, 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);