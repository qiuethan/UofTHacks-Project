import { WebSocket } from 'ws';
import type { WorldEvent, WorldSnapshot } from '../../world/index.ts';

export interface Client {
  ws: WebSocket;
  oderId: string;
  userId: string;
  displayName: string;
  isReplaced?: boolean;
}

export interface ClientMessage {
  type: 'JOIN' | 'MOVE' | 'WATCH' | 'SET_DIRECTION';
  token?: string;
  userId?: string;
  displayName?: string;
  x?: number;
  y?: number;
  dx?: 0 | 1 | -1;
  dy?: 0 | 1 | -1;
}

export interface ServerMessage {
  type: 'SNAPSHOT' | 'EVENTS' | 'ERROR' | 'WELCOME' | 'KICKED';
  snapshot?: WorldSnapshot;
  events?: WorldEvent[];
  error?: string;
  entityId?: string;
}
