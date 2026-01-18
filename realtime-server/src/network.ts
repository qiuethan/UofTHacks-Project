import { WebSocket } from 'ws';
import { clients, spectators, userConnections } from './state';
import type { ServerMessage } from './types';

export function broadcast(message: ServerMessage, exclude?: string | string[]) {
  const data = JSON.stringify(message);
  const excludeSet = new Set(Array.isArray(exclude) ? exclude : exclude ? [exclude] : []);
  // Send to players
  for (const [id, client] of clients) {
    if (!excludeSet.has(id) && client.ws.readyState === WebSocket.OPEN) {
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

export function broadcastToSpectators(message: ServerMessage) {
  const data = JSON.stringify(message);
  for (const ws of spectators) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

export function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Send a message to a specific user by their userId.
 * Does nothing if the user is not connected.
 */
export function sendToUser(userId: string, message: ServerMessage) {
  const orderId = userConnections.get(userId);
  if (orderId) {
    const client = clients.get(orderId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }
}
