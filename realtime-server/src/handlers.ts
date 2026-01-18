import { WebSocket } from 'ws';
import { supabase, getPosition, updatePosition } from './db';
import { world } from './game';
import { clients, userConnections } from './state';
import { send, broadcast } from './network';
import type { Client, ClientMessage } from './types';
import { createAvatar, createEntity, type SetDirectionAction } from '../../world/index.ts';

export async function handleJoin(ws: WebSocket, oderId: string, msg: ClientMessage): Promise<Client | null> {
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
  let pos = await getPosition(userId);
  
  // Use display name from DB if available, otherwise use provided name
  const actualDisplayName = pos.displayName || displayName;
  client.displayName = actualDisplayName;
  
  // If user has an AI agent active, take over its position and replace it
  const existing = world.getEntity(userId);
  console.log(`[handleJoin] Existing entity for ${userId}:`, existing ? { kind: existing.kind, x: existing.x, y: existing.y } : 'none');
  
  if (existing && existing.kind === 'ROBOT') {
    // Convert ROBOT to PLAYER in-place (no remove/add to prevent flickering)
    const result = world.updateEntityKind(userId, 'PLAYER');
    console.log(`[handleJoin] Converted ROBOT to PLAYER: ${actualDisplayName} (${userId})`);
    
    if (result.ok) {
      broadcast({ type: 'EVENTS', events: result.value }, oderId);
    }
    
    send(ws, { type: 'WELCOME', entityId: userId });
    send(ws, { type: 'SNAPSHOT', snapshot: world.getSnapshot() });
    return client;
  }
  
  if (existing && existing.kind === 'PLAYER') {
    // Player rejoining
    console.log(`Player rejoined: ${actualDisplayName} (${userId})`);
    send(ws, { type: 'WELCOME', entityId: userId });
    send(ws, { type: 'SNAPSHOT', snapshot: world.getSnapshot() });
    return client;
  }
  
  // No existing entity - create new player
  const facing = pos.facing as { x: 0 | 1 | -1; y: 0 | 1 | -1 } | undefined;
  const avatar: any = {
    ...createAvatar(userId, actualDisplayName, pos.x, pos.y, facing),
    sprites: pos.sprites
  };
  
  const result = world.addEntity(avatar);
  
  if (!result.ok) {
    send(ws, { type: 'ERROR', error: result.error.message });
    ws.close();
    return null;
  }
  
  console.log(`Player joined: ${actualDisplayName} (${userId}) at (${pos.x}, ${pos.y})${pos.sprites ? ' [has sprites]' : ''}`);
  
  send(ws, { type: 'WELCOME', entityId: userId });
  send(ws, { type: 'SNAPSHOT', snapshot: world.getSnapshot() });
  broadcast({ type: 'EVENTS', events: result.value }, oderId);
  
  return client;
}

export async function handleSetDirection(client: Client, dx: 0|1|-1, dy: 0|1|-1): Promise<void> {
    const action: SetDirectionAction = { type: 'SET_DIRECTION', dx, dy };
  const result = world.submitAction(client.userId, action);
  
  if (!result.ok) {
    send(client.ws, { type: 'ERROR', error: result.error.message });
    return;
  }

  // Broadcast any events (e.g., ENTITY_TURNED)
  if (result.value.length > 0) {
    broadcast({ type: 'EVENTS', events: result.value });
  }
}

// ============================================================================
// CONVERSATION HANDLERS
// ============================================================================

export async function handleRequestConversation(client: Client, targetEntityId: string): Promise<void> {
  const result = world.requestConversation(client.userId, targetEntityId);
  
  if (!result.ok) {
    send(client.ws, { type: 'ERROR', error: result.error.message });
    return;
  }
  
  // Broadcast conversation request event
  broadcast({ type: 'EVENTS', events: result.value });
}

export async function handleAcceptConversation(client: Client, requestId: string): Promise<void> {
  const result = world.acceptConversation(client.userId, requestId);
  
  if (!result.ok) {
    send(client.ws, { type: 'ERROR', error: result.error.message });
    return;
  }
  
  // Broadcast conversation accepted event
  broadcast({ type: 'EVENTS', events: result.value });
}

export async function handleRejectConversation(client: Client, requestId: string): Promise<void> {
  const result = world.rejectConversation(client.userId, requestId);
  
  if (!result.ok) {
    send(client.ws, { type: 'ERROR', error: result.error.message });
    return;
  }
  
  // Broadcast conversation rejected event
  broadcast({ type: 'EVENTS', events: result.value });
}

export async function handleEndConversation(client: Client): Promise<void> {
  const result = world.endConversation(client.userId);
  
  if (!result.ok) {
    send(client.ws, { type: 'ERROR', error: result.error.message });
    return;
  }
  
  // Broadcast conversation ended event
  broadcast({ type: 'EVENTS', events: result.value });
}

export async function handleDisconnect(client: Client, oderId: string) {
    console.log(`[handleDisconnect] Called for ${client.userId}, isReplaced: ${client.isReplaced}`);
    // If this client was replaced by a new connection, don't remove the entity
    if (client.isReplaced) {
      console.log(`Client replaced: ${client.userId}`);
      clients.delete(oderId);
      return;
    }
    
    console.log(`Client disconnected: ${client.userId}`);
    
    // Save final position and convert to AI
    const entity = world.getEntity(client.userId);
    console.log(`[handleDisconnect] Entity for ${client.userId}:`, entity ? { kind: entity.kind } : 'none');
    if (entity) {
      await updatePosition(
        client.userId, 
        entity.x, 
        entity.y, 
        entity.facing,
        entity.conversationState,
        entity.conversationTargetId,
        entity.conversationPartnerId,
        entity.pendingConversationRequestId
      );

      // Convert to ROBOT for AI control (in-place to avoid sprite flickering)
      const result = world.updateEntityKind(client.userId, 'ROBOT');
      console.log(`[handleDisconnect] updateEntityKind result:`, result.ok ? 'ok' : result.error);
      if (result.ok) {
        broadcast({ type: 'EVENTS', events: result.value });
      } else {
        console.error(`[handleDisconnect] Failed to convert to ROBOT:`, result.error);
      }
    }
    
    // Clean up tracking
    if (userConnections.get(client.userId) === oderId) {
      userConnections.delete(client.userId);
    }
    clients.delete(oderId);
}
