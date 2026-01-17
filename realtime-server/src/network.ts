import { WebSocket } from 'ws';
import { clients, spectators } from './state';
import type { ServerMessage } from './types';

export function broadcast(message: ServerMessage, exclude?: string) {
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

export function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
