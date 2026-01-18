import { WebSocket } from 'ws';
import { supabase, getPosition, updatePosition } from './db';
import { world, activeConversations } from './game';
import { clients, userConnections } from './state';
import { send, broadcast, sendToUser, broadcastToSpectators } from './network';
import type { Client, ClientMessage, ChatMessage } from './types';
import { createAvatar, createEntity, type SetDirectionAction } from '../../world/index.ts';
import { API_BASE_URL } from './config';

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
    
    // If the agent was in a conversation, send the conversation history to the player
    const convData = activeConversations.get(userId);
    console.log(`[handleJoin] Checking for active conversation for ${userId.substring(0, 8)}: ${convData ? 'found' : 'none'}`);
    if (convData) {
      console.log(`[handleJoin] Conversation ${convData.conversationId.substring(0, 8)} has ${convData.messages.length} messages`);
      if (convData.messages.length > 0) {
        console.log(`[handleJoin] Sending ${convData.messages.length} existing messages to player taking over`);
        
        // Send each message in the conversation history
        for (const msg of convData.messages) {
          console.log(`[handleJoin] Sending msg: ${msg.id.substring(0, 8)} from ${msg.senderName}: ${msg.content.substring(0, 30)}...`);
          send(ws, {
            type: 'CHAT_MESSAGE' as const,
            messageId: msg.id,
            senderId: msg.senderId,
            senderName: msg.senderName,
            content: msg.content,
            timestamp: msg.timestamp,
            conversationId: convData.conversationId
          });
        }
      }
    }
    
    return client;
  }
  
  if (existing && existing.kind === 'PLAYER') {
    // Player rejoining
    console.log(`Player rejoined: ${actualDisplayName} (${userId})`);
    send(ws, { type: 'WELCOME', entityId: userId });
    send(ws, { type: 'SNAPSHOT', snapshot: world.getSnapshot() });
    
    // If the player was in a conversation, send the conversation history
    const convData = activeConversations.get(userId);
    if (convData && convData.messages.length > 0) {
      console.log(`[handleJoin] Sending ${convData.messages.length} existing messages to rejoining player`);
      
      for (const msg of convData.messages) {
        send(ws, {
          type: 'CHAT_MESSAGE' as const,
          messageId: msg.id,
          senderId: msg.senderId,
          senderName: msg.senderName,
          content: msg.content,
          timestamp: msg.timestamp,
          conversationId: convData.conversationId
        });
      }
    }
    
    return client;
  }
  
  // No existing entity - create new player
  const facing = pos.facing as { x: 0 | 1 | -1; y: 0 | 1 | -1 } | undefined;
  const avatar: any = {
    ...createAvatar(userId, actualDisplayName, pos.x, pos.y, facing),
    sprites: pos.sprites,
    stats: pos.stats
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
  
  // Initialize conversation tracking
  const entity = world.getEntity(client.userId);
  if (entity?.conversationPartnerId) {
    await initializeConversationTracking(client.userId, entity.conversationPartnerId);
  }
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
  const entity = world.getEntity(client.userId);
  const partnerId = entity?.conversationPartnerId;
  const partnerEntity = partnerId ? world.getEntity(partnerId) : null;
  
  // Get conversation data before ending
  const conversationData = activeConversations.get(client.userId) || activeConversations.get(partnerId || '');
  
  const result = world.endConversation(client.userId);
  
  if (!result.ok) {
    send(client.ws, { type: 'ERROR', error: result.error.message });
    return;
  }
  
  // Broadcast conversation ended event
  broadcast({ type: 'EVENTS', events: result.value });
  
  // Process conversation end (update sentiment, memories, etc.)
  if (conversationData && partnerId) {
    const isPartnerOnline = userConnections.has(partnerId);
    const isClientOnline = true; // Client is always online if they're ending
    
    try {
      await processConversationEnd(
        conversationData.conversationId,
        client.userId,
        partnerId,
        client.displayName,
        partnerEntity?.displayName || 'Unknown',
        conversationData.messages,
        isClientOnline,
        isPartnerOnline
      );
      
      // Force sync stats immediately so UI updates for both participants
      const { syncAgentStats } = await import('./game');
      console.log(`[EndConv] Forcing stats sync for UI update`);
      await syncAgentStats(true);
      
    } catch (e) {
      console.error('Error processing conversation end:', e);
    }
    
    // Clean up conversation tracking
    activeConversations.delete(client.userId);
    activeConversations.delete(partnerId);
  }
}

// ============================================================================
// CHAT MESSAGE HANDLER
// ============================================================================

export async function handleChatMessage(client: Client, content: string): Promise<void> {
  const entity = world.getEntity(client.userId);
  
  if (!entity || entity.conversationState !== 'IN_CONVERSATION') {
    send(client.ws, { type: 'ERROR', error: 'Not in a conversation' });
    return;
  }
  
  const partnerId = entity.conversationPartnerId;
  if (!partnerId) {
    send(client.ws, { type: 'ERROR', error: 'No conversation partner' });
    return;
  }
  
  const partnerEntity = world.getEntity(partnerId);
  if (!partnerEntity) {
    send(client.ws, { type: 'ERROR', error: 'Partner not found' });
    return;
  }
  
  // Get or create conversation tracking
  let convData = activeConversations.get(client.userId) || activeConversations.get(partnerId);
  if (!convData) {
    // Create new conversation record
    const conversationId = await getOrCreateConversation(client.userId, partnerId);
    convData = {
      conversationId,
      participant1: client.userId,
      participant2: partnerId,
      messages: [],
      lastMessageAt: Date.now()
    };
    activeConversations.set(client.userId, convData);
    activeConversations.set(partnerId, convData);
  }
  
  // Create the chat message - marked as player controlled since it's from a real user
  const message: ChatMessage = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    senderId: client.userId,
    senderName: client.displayName,
    content,
    timestamp: Date.now(),
    conversationId: convData.conversationId,
    isPlayerControlled: true  // Message from real human player
  };
  
  // Add to local tracking
  convData.messages.push(message);
  convData.lastMessageAt = Date.now();
  
  // Store in database
  try {
    await addMessageToConversation(convData.conversationId, client.userId, client.displayName, content);
  } catch (e) {
    console.error('Error storing message:', e);
  }
  
  // Analyze message sentiment in real-time (updates mood if rude/positive)
  try {
    analyzeMessageSentiment(
      content, 
      client.userId, 
      client.displayName, 
      partnerId, 
      partnerEntity.displayName || 'Partner'
    ).then(async (sentimentResult) => {
      if (sentimentResult && (sentimentResult.is_rude || sentimentResult.is_positive)) {
        console.log(`[Sentiment] Message analyzed: rude=${sentimentResult.is_rude}, positive=${sentimentResult.is_positive}`);
        // Force sync stats to show mood change in UI
        const { syncAgentStats } = await import('./game');
        await syncAgentStats(true);
      }
    }).catch(e => console.error('Sentiment analysis error:', e));
  } catch (e) {
    console.error('Error starting sentiment analysis:', e);
  }
  
  // Create chat event
  const chatEvent = {
    type: 'CHAT_MESSAGE' as const,
    messageId: message.id,
    senderId: message.senderId,
    senderName: message.senderName,
    content: message.content,
    timestamp: message.timestamp,
    conversationId: convData.conversationId
  };
  
  // Send to the sender
  send(client.ws, chatEvent);
  
  // Send to the partner if online
  sendToUser(partnerId, chatEvent);
  
  // Broadcast to spectators only (not to players, to avoid double-sending)
  broadcastToSpectators(chatEvent);
  
  // If partner is offline (ROBOT), generate AI response
  // This is the ONLY place where player-agent conversation responses are generated
  // The agent-agent loop in game.ts will skip this conversation because the player is online
  const isPartnerOnline = userConnections.has(partnerId);
  if (!isPartnerOnline && partnerEntity.kind === 'ROBOT') {
    console.log(`[Player→Agent] ${client.displayName} → ${partnerEntity.displayName}: ${content.substring(0, 50)}...`);
    
    try {
      const agentResponse = await generateAgentResponse(
        partnerId,
        client.userId,
        client.displayName,
        content,
        convData.messages
      );
      
      if (agentResponse) {
        // Create agent's message - marked as NOT player controlled since it's LLM-generated
        const agentMessage: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          senderId: partnerId,
          senderName: partnerEntity.displayName || 'Agent',
          content: agentResponse,
          timestamp: Date.now(),
          conversationId: convData.conversationId,
          isPlayerControlled: false  // Message from LLM automation
        };
        
        // Add to tracking
        convData.messages.push(agentMessage);
        convData.lastMessageAt = Date.now();
        
        // Store in database
        await addMessageToConversation(
          convData.conversationId, 
          partnerId, 
          partnerEntity.displayName || 'Agent', 
          agentResponse
        );
        
        // Send agent's response to the player and broadcast for spectators
        const agentChatEvent = {
          type: 'CHAT_MESSAGE' as const,
          messageId: agentMessage.id,
          senderId: agentMessage.senderId,
          senderName: agentMessage.senderName,
          content: agentMessage.content,
          timestamp: agentMessage.timestamp,
          conversationId: convData.conversationId
        };
        
        console.log(`[Agent→Player] ${partnerEntity.displayName} → ${client.displayName}: ${agentResponse.substring(0, 50)}...`);
        
        // Send to the player
        send(client.ws, agentChatEvent);
        
        // Broadcast to spectators only (not to players, to avoid double-sending)
        broadcastToSpectators(agentChatEvent);
        
        // Check if the agent wants to end the conversation
        const shouldEndResult = await checkAgentWantsToEnd(
          partnerId,
          partnerEntity.displayName || 'Agent',
          client.userId,
          client.displayName,
          convData.messages,
          agentResponse
        );
        
        if (shouldEndResult.should_end) {
          console.log(`[Agent→Player] Agent ${partnerEntity.displayName} chose to END conversation: ${shouldEndResult.reason}`);
          
          // Send farewell message if provided
          if (shouldEndResult.farewell_message && shouldEndResult.farewell_message !== agentResponse) {
            const farewellMsg: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              senderId: partnerId,
              senderName: partnerEntity.displayName || 'Agent',
              content: shouldEndResult.farewell_message,
              timestamp: Date.now(),
              conversationId: convData.conversationId,
              isPlayerControlled: false
            };
            convData.messages.push(farewellMsg);
            
            const farewellEvent = {
              type: 'CHAT_MESSAGE' as const,
              messageId: farewellMsg.id,
              senderId: farewellMsg.senderId,
              senderName: farewellMsg.senderName,
              content: farewellMsg.content,
              timestamp: farewellMsg.timestamp,
              conversationId: convData.conversationId
            };
            send(client.ws, farewellEvent);
            broadcastToSpectators(farewellEvent);
          }
          
          // End the conversation - pass reason and agent name for notifications
          const endResult = world.endConversation(
            partnerId,
            partnerEntity.displayName || 'Agent',
            shouldEndResult.reason
          );
          if (endResult.ok) {
            broadcast({ type: 'EVENTS', events: endResult.value });
          }
          
          // Process conversation end
          const { processConversationEndAsync } = await import('./game');
          await processConversationEndAsync(convData);
          activeConversations.delete(client.userId);
          activeConversations.delete(partnerId);
        }
      }
    } catch (e) {
      console.error('Error generating agent response:', e);
    }
  }
}

// ============================================================================
// CONVERSATION INITIALIZATION
// ============================================================================

async function initializeConversationTracking(participant1: string, participant2: string): Promise<void> {
  // Check if already tracking
  if (activeConversations.has(participant1) || activeConversations.has(participant2)) {
    return;
  }
  
  // Create conversation record
  const conversationId = await getOrCreateConversation(participant1, participant2);
  
  const convData = {
    conversationId,
    participant1,
    participant2,
    messages: [] as ChatMessage[],
    lastMessageAt: Date.now()
  };
  
  activeConversations.set(participant1, convData);
  activeConversations.set(participant2, convData);
  
  console.log(`Initialized conversation tracking: ${conversationId} between ${participant1.substring(0, 8)} and ${participant2.substring(0, 8)}`);
}

// Also export for use in game.ts
export { initializeConversationTracking };

// ============================================================================
// API HELPERS
// ============================================================================

async function getOrCreateConversation(participantA: string, participantB: string): Promise<string> {
  try {
    const response = await fetch(`${API_BASE_URL}/conversation/get-or-create?participant_a=${participantA}&participant_b=${participantB}`, {
      method: 'POST'
    });
    const data = await response.json();
    return data.conversation_id || `conv-${Date.now()}`;
  } catch (e) {
    console.error('Error creating conversation:', e);
    return `conv-${Date.now()}`;
  }
}

async function addMessageToConversation(conversationId: string, senderId: string, senderName: string, content: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/conversation/${conversationId}/message?sender_id=${senderId}&sender_name=${encodeURIComponent(senderName)}&content=${encodeURIComponent(content)}`, {
      method: 'POST'
    });
  } catch (e) {
    console.error('Error adding message to conversation:', e);
  }
}

async function generateAgentResponse(
  agentId: string,
  partnerId: string,
  partnerName: string,
  message: string,
  conversationHistory: ChatMessage[]
): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/conversation/agent-respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationHistory[0]?.conversationId || '',
        agent_id: agentId,
        partner_id: partnerId,
        partner_name: partnerName,
        message,
        conversation_history: conversationHistory.map(m => ({
          senderId: m.senderId,
          senderName: m.senderName,
          content: m.content,
          timestamp: m.timestamp
        }))
      })
    });
    const data = await response.json();
    return data.ok ? data.response : null;
  } catch (e) {
    console.error('Error generating agent response:', e);
    return null;
  }
}

interface SentimentResult {
  ok: boolean;
  sender_mood_change: number;
  receiver_mood_change: number;
  sentiment: number;
  is_rude: boolean;
  is_positive: boolean;
}

async function analyzeMessageSentiment(
  message: string,
  senderId: string,
  senderName: string,
  receiverId: string,
  receiverName: string
): Promise<SentimentResult | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/conversation/analyze-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        sender_id: senderId,
        sender_name: senderName,
        receiver_id: receiverId,
        receiver_name: receiverName
      })
    });
    const data = await response.json();
    return data as SentimentResult;
  } catch (e) {
    console.error('Error analyzing message sentiment:', e);
    return null;
  }
}

interface ShouldEndResult {
  should_end: boolean;
  farewell_message?: string;
  reason?: string;
}

/**
 * Check if an agent wants to end a conversation with a player.
 * Based on conversation flow, sentiment, rudeness, and agent state.
 */
async function checkAgentWantsToEnd(
  agentId: string,
  agentName: string,
  partnerId: string,
  partnerName: string,
  conversationHistory: ChatMessage[],
  lastMessage: string
): Promise<ShouldEndResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/conversation/should-end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        agent_name: agentName,
        partner_id: partnerId,
        partner_name: partnerName,
        conversation_history: conversationHistory.map(m => ({
          senderId: m.senderId,
          senderName: m.senderName,
          content: m.content,
          timestamp: m.timestamp
        })),
        last_message: lastMessage
      })
    });
    const data = await response.json();
    return {
      should_end: data.should_end || false,
      farewell_message: data.farewell_message,
      reason: data.reason
    };
  } catch (e) {
    console.error('Error checking if agent wants to end:', e);
    return { should_end: false }; // Default to continue on error
  }
}

async function processConversationEnd(
  conversationId: string,
  participantA: string,
  participantB: string,
  participantAName: string,
  participantBName: string,
  transcript: ChatMessage[],
  participantAIsOnline: boolean,
  participantBIsOnline: boolean
): Promise<void> {
  console.log(`[ConvEnd] Processing conversation end: ${conversationId}`);
  console.log(`[ConvEnd] Participants: ${participantAName} (${participantA.substring(0, 8)}) & ${participantBName} (${participantB.substring(0, 8)})`);
  console.log(`[ConvEnd] Transcript: ${transcript.length} messages`);
  
  try {
    const response = await fetch(`${API_BASE_URL}/conversation/end-process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        participant_a: participantA,
        participant_b: participantB,
        participant_a_name: participantAName,
        participant_b_name: participantBName,
        transcript: transcript.map(m => ({
          senderId: m.senderId,
          senderName: m.senderName,
          content: m.content,
          timestamp: m.timestamp,
          isPlayerControlled: m.isPlayerControlled ?? false  // Pass the player control flag
        })),
        participant_a_is_online: participantAIsOnline,
        participant_b_is_online: participantBIsOnline
      })
    });
    
    const result = await response.json();
    console.log(`[ConvEnd] API response:`, result);
    
    if (!result.ok) {
      console.error(`[ConvEnd] API returned error:`, result.error);
    }
  } catch (e) {
    console.error('[ConvEnd] Error processing conversation end:', e);
  }
}

// ============================================================================
// RESPAWN HANDLER
// ============================================================================

export async function handleRespawn(client: Client): Promise<void> {
  const { MAP_WIDTH, MAP_HEIGHT } = await import('./config');
  
  // Calculate center position
  const centerX = Math.floor(MAP_WIDTH / 2);
  const centerY = Math.floor(MAP_HEIGHT / 2);
  
  // Move the entity in the world
  const result = world.moveEntityTo(client.userId, centerX, centerY);
  
  if (!result.ok) {
    send(client.ws, { type: 'ERROR', error: result.error.message });
    return;
  }
  
  // Also update the database
  await updatePosition(client.userId, centerX, centerY, { x: 0, y: 1 });
  
  // Broadcast the move event
  if (result.value.length > 0) {
    broadcast({ type: 'EVENTS', events: result.value });
  }
  
  console.log(`[Respawn] ${client.displayName} respawned to (${centerX}, ${centerY})`);
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
