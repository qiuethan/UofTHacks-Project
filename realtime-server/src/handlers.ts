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
  let existingConversationState: any = {};
  let robotTakeover = false;
  
  if (existing && existing.kind === 'ROBOT') {
    robotTakeover = true;
    pos = { ...pos, x: existing.x, y: existing.y, facing: existing.facing || pos.facing }; // Preserve facing from robot
    
    // Capture conversation state to restore it to the player
    existingConversationState = {
      conversationState: existing.conversationState,
      conversationTargetId: existing.conversationTargetId,
      conversationPartnerId: existing.conversationPartnerId,
      pendingConversationRequestId: existing.pendingConversationRequestId
    };

    // Remove the robot so we can spawn the player
    const removeResult = world.removeEntity(userId);
    if (removeResult.ok) {
       broadcast({ type: 'EVENTS', events: removeResult.value }, oderId);
    } else {
      console.error(`Failed to remove ROBOT for player takeover: ${userId}`, removeResult.error);
      // Force remove from internal state if needed
      robotTakeover = false;
    }
  }
  
  // Use userId as entityId for consistency
  const facing = pos.facing as { x: 0 | 1 | -1; y: 0 | 1 | -1 } | undefined;
  const avatar: any = {
    ...createAvatar(userId, actualDisplayName, pos.x, pos.y, facing),
    ...existingConversationState,
    // Add sprite URLs if available
    sprites: pos.sprites
  };
  
  const result = world.addEntity(avatar);
  
  if (!result.ok) {
    if (result.error.code === 'ENTITY_EXISTS') {
      // Entity exists - check if it's a ROBOT that needs to be converted to PLAYER
      const existingEntity = world.getEntity(userId);
      if (existingEntity && existingEntity.kind === 'ROBOT') {
        // Update the entity kind to PLAYER so AI loop won't control it
        (existingEntity as any).kind = 'PLAYER';
        console.log(`Player took over ROBOT: ${actualDisplayName} (${userId})`);
      } else {
        console.log(`Player rejoined: ${actualDisplayName} (${userId})`);
      }
      send(ws, { type: 'WELCOME', entityId: userId });
      send(ws, { type: 'SNAPSHOT', snapshot: world.getSnapshot() });
      return client;
    } else {
      send(ws, { type: 'ERROR', error: result.error.message });
      ws.close();
      return null;
    }
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

      // Convert to ROBOT for AI control
      const removeResult = world.removeEntity(client.userId);
      console.log(`[handleDisconnect] removeEntity result:`, removeResult.ok ? 'ok' : removeResult.error);
      const robot: any = {
        ...entity,
        kind: 'ROBOT',
        direction: { x: 0, y: 0 },
        targetPosition: undefined,
        plannedPath: undefined
      };
      
      const result = world.addEntity(robot);
      console.log(`[handleDisconnect] addEntity result:`, result.ok ? 'ok' : result.error);
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
