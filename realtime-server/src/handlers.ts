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
  
  // If user has an AI agent active, take over its position and replace it
  const existing = world.getEntity(userId);
  if (existing && existing.kind === 'ROBOT') {
    pos = { x: existing.x, y: existing.y };
    // Remove the robot so we can spawn the player
    const removeResult = world.removeEntity(userId);
    if (removeResult.ok) {
       broadcast({ type: 'EVENTS', events: removeResult.value }, oderId);
    }
  }
  
  // Use userId as entityId for consistency
  const avatar = createAvatar(userId, displayName, pos.x, pos.y);
  const result = world.addEntity(avatar);
  
  if (!result.ok) {
    if (result.error.code === 'ENTITY_EXISTS') {
      // This is fine, entity is already there (seamless handover)
      console.log(`Player rejoined: ${displayName} (${userId})`);
      send(ws, { type: 'WELCOME', entityId: userId });
      send(ws, { type: 'SNAPSHOT', snapshot: world.getSnapshot() });
      return client;
    } else {
      send(ws, { type: 'ERROR', error: result.error.message });
      ws.close();
      return null;
    }
  }
  
  console.log(`Player joined: ${displayName} (${userId}) at (${pos.x}, ${pos.y})`);
  
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
}

export async function handleDisconnect(client: Client, oderId: string) {
    // If this client was replaced by a new connection, don't remove the entity
    if (client.isReplaced) {
      console.log(`Client replaced: ${client.userId}`);
      clients.delete(oderId);
      return;
    }
    
    console.log(`Client disconnected: ${client.userId}`);
    
    // Save final position and convert to AI
    const entity = world.getEntity(client.userId);
    if (entity) {
      await updatePosition(client.userId, entity.x, entity.y);

      // Convert to ROBOT for AI control
      world.removeEntity(client.userId);
      const robot = createEntity(
        entity.entityId,
        'ROBOT',
        entity.displayName,
        entity.x,
        entity.y,
        entity.color
      );
      const result = world.addEntity(robot);
      if (result.ok) {
        broadcast({ type: 'EVENTS', events: result.value });
      }
    }
    
    // Clean up tracking
    if (userConnections.get(client.userId) === oderId) {
      userConnections.delete(client.userId);
    }
    clients.delete(oderId);
}
