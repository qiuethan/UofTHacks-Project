import { WebSocket } from 'ws';
import type { Client } from './types';

// Map oderId -> Client (oderId = one-time connection ID)
export const clients = new Map<string, Client>();

// Map userId -> oderId (for session handover)
export const userConnections = new Map<string, string>();

// Spectators (watch-only connections)
export const spectators = new Set<WebSocket>();

// Connection ID counter
let nextOrderId = 1;
export function generateOrderId(): string {
  return `conn-${nextOrderId++}`;
}

let nextWatcherId = 1;
export function generateWatcherId(): string {
    return `watcher-${nextWatcherId++}`;
}
