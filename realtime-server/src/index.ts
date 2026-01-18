import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { PLAY_PORT, WATCH_PORT } from './config';
import { startGameLoop, startAiLoop, loadExistingUsers, world, startConversationTimeoutLoop, startAgentAgentConversationLoop, startStatsSyncLoop, addNpcToWorld } from './game';
import { generateOrderId, generateWatcherId, spectators } from './state';
import { handleJoin, handleSetDirection, handleDisconnect, handleRequestConversation, handleAcceptConversation, handleRejectConversation, handleEndConversation, handleChatMessage, handleRespawn } from './handlers';
import { send, broadcast } from './network';
import type { ClientMessage, Client } from './types';

// Initialize the world and start loops
async function initialize() {
  // Load existing users (including NPCs) from database first
  await loadExistingUsers();
  
  // Start game loops
  startGameLoop();
  startAiLoop();
  startConversationTimeoutLoop();
  startAgentAgentConversationLoop();
  startStatsSyncLoop();
  
  console.log('Game world initialized with existing users loaded');
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
      } else if (msg.type === 'RESPAWN' && client) {
        await handleRespawn(client);
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
// HTTP API SERVER (port 3005) - For adding NPCs dynamically
// ============================================================================

const HTTP_PORT = 3005;

const httpServer = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.method === 'POST' && req.url === '/add-npc') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const { npc_id } = data;
        
        if (!npc_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'npc_id is required' }));
          return;
        }
        
        console.log(`[HTTP] Adding NPC ${npc_id} to world...`);
        const result = await addNpcToWorld(npc_id);
        
        if (result.ok) {
          // Broadcast the new entity to all clients
          const snapshot = world.getSnapshot();
          broadcast({ type: 'SNAPSHOT', snapshot });
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: 'NPC added to world' }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: result.error }));
        }
      } catch (e) {
        console.error('[HTTP] Error adding NPC:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Internal server error' }));
      }
    });
  } else if (req.method === 'POST' && req.url === '/reload-users') {
    // Reload all users from database
    console.log('[HTTP] Reloading all users from database...');
    await loadExistingUsers();
    
    // Broadcast updated snapshot
    const snapshot = world.getSnapshot();
    broadcast({ type: 'SNAPSHOT', snapshot });
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Users reloaded' }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`HTTP API server running on http://localhost:${HTTP_PORT}`);
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
  
  httpServer.close(() => {
    console.log('HTTP server closed');
  });

  // Force exit if it takes too long
  setTimeout(() => {
    console.error('Forcing shutdown...');
    process.exit(1);
  }, 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);