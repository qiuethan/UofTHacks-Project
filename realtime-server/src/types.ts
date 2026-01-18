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
  type: 'JOIN' | 'MOVE' | 'WATCH' | 'SET_DIRECTION' | 'REQUEST_CONVERSATION' | 'ACCEPT_CONVERSATION' | 'REJECT_CONVERSATION' | 'END_CONVERSATION' | 'CHAT_MESSAGE';
  token?: string;
  userId?: string;
  displayName?: string;
  x?: number;
  y?: number;
  dx?: 0 | 1 | -1;
  dy?: 0 | 1 | -1;
  // Conversation fields
  targetEntityId?: string;
  requestId?: string;
  // Chat message fields
  content?: string;
}

export interface ServerMessage {
  type: 'SNAPSHOT' | 'EVENTS' | 'ERROR' | 'WELCOME' | 'KICKED' | 'CHAT_MESSAGE';
  snapshot?: WorldSnapshot;
  events?: WorldEvent[];
  error?: string;
  entityId?: string;
  // Chat message fields
  messageId?: string;
  senderId?: string;
  senderName?: string;
  content?: string;
  timestamp?: number;
  conversationId?: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  conversationId?: string;
  // Flag to track if this message was from a human player (true) or LLM automation (false)
  isPlayerControlled?: boolean;
}
