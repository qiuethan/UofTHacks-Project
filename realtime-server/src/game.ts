import { World, createWall, createAvatar, CONVERSATION_CONFIG, MAIN_MAP, findPath } from '../../world/index.ts';
import { MAP_WIDTH, MAP_HEIGHT, TICK_RATE, AI_TICK_RATE, API_URL, CONVERSATION_TIMEOUT_MS, API_BASE_URL } from './config';
import { broadcast, broadcastToSpectators } from './network';
import { generateWallPositions, INDIVIDUAL_WALLS } from './walls';
import { getAllUsers, getAllAgentStats, supabase } from './db';
import type { ChatMessage } from './types';

// Use the main map with collision data from the Tiled map
export const world = new World(MAIN_MAP);

// Track active conversations for chat messages
export interface ActiveConversation {
  conversationId: string;
  participant1: string;
  participant2: string;
  messages: ChatMessage[];
  lastMessageAt: number;
}

export const activeConversations = new Map<string, ActiveConversation>();

// Lock to prevent concurrent processing of the same conversation
const conversationsBeingProcessed = new Set<string>();

// ============================================================================
// AGENT DECISION HELPERS
// ============================================================================

interface ShouldEndResult {
  should_end: boolean;
  farewell_message?: string;
  reason?: string;
}

interface ShouldAcceptResult {
  should_accept: boolean;
  reason?: string;
}

interface ShouldInitiateResult {
  should_initiate: boolean;
  reason?: string;
}

/**
 * Check if an agent should accept a conversation request.
 * Based on sentiment, mood, energy, and relationship with requester.
 * Returns the decision and reason.
 */
async function checkShouldAcceptConversation(
  agentId: string,
  agentName: string,
  requesterId: string,
  requesterName: string
): Promise<ShouldAcceptResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/conversation/should-accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        agent_name: agentName,
        requester_id: requesterId,
        requester_name: requesterName
      })
    });
    const data = await response.json();
    console.log(`[AcceptCheck] ${agentName} → ${requesterName}: ${data.should_accept ? 'ACCEPT' : 'REJECT'} (${data.reason || 'no reason'})`);
    return { 
      should_accept: data.should_accept !== false,
      reason: data.reason
    };
  } catch (e) {
    console.error('Error checking should-accept:', e);
    return { should_accept: true, reason: 'Happy to chat' };
  }
}

/**
 * Check if an agent should initiate a conversation with another entity.
 * Based on sentiment, mood, loneliness, and shared interests.
 * Returns the decision and a personalized reason/greeting.
 */
async function checkShouldInitiateConversation(
  agentId: string,
  agentName: string,
  targetId: string,
  targetName: string
): Promise<ShouldInitiateResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/conversation/should-initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agentId,
        agent_name: agentName,
        target_id: targetId,
        target_name: targetName
      })
    });
    const data = await response.json();
    console.log(`[InitiateCheck] ${agentName} → ${targetName}: ${data.should_initiate ? 'YES' : 'NO'} (${data.reason || 'no reason'})`);
    return { 
      should_initiate: data.should_initiate === true,
      reason: data.reason
    };
  } catch (e) {
    console.error('Error checking should-initiate:', e);
    return { should_initiate: false };
  }
}

/**
 * Check if an agent wants to end a conversation.
 * Based on conversation flow, sentiment, rudeness, and agent state.
 */
async function checkShouldEndConversation(
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
    console.error('Error checking should-end:', e);
    return { should_end: false }; // Default to continue on error
  }
}

// Add perimeter walls (1x1 entities)
// Top and Bottom edges
for (let x = 0; x < MAP_WIDTH; x++) {
  world.addEntity(createWall(`wall-top-${x}`, x, 0));
  world.addEntity(createWall(`wall-bottom-${x}`, x, MAP_HEIGHT - 1));
}

// Left and Right edges (skipping corners already handled)
for (let y = 1; y < MAP_HEIGHT - 1; y++) {
  world.addEntity(createWall(`wall-left-${y}`, 0, y));
  world.addEntity(createWall(`wall-right-${y}`, MAP_WIDTH - 1, y));
}

// Add all walls from configuration (perimeter + custom walls from walls.ts)
const wallPositions = generateWallPositions();
for (const wall of wallPositions) {
  world.addEntity(createWall(wall.id, wall.x, wall.y));
}

// Add individual walls
for (const pos of INDIVIDUAL_WALLS) {
  world.addEntity(createWall(`wall-individual-${pos.x}-${pos.y}`, pos.x, pos.y));
}

/**
 * Load all existing users from the database and add them to the world as ROBOTs.
 * This ensures that all registered users are visible in the game world,
 * even if they're not currently online.
 */
export async function loadExistingUsers(): Promise<void> {
  console.log('Loading existing users from database...');
  
  const users = await getAllUsers();
  let loadedCount = 0;
  
  for (const user of users) {
    // Skip if entity already exists (shouldn't happen on fresh start, but safety check)
    if (world.getEntity(user.userId)) {
      continue;
    }
    
    // Log user data for debugging
    console.log(`  Loading user: ${user.displayName || 'Anonymous'} (${user.userId.substring(0, 8)}...)`, {
      hasSprites: !!user.sprites,
      sprites: user.sprites ? {
        front: user.sprites.front ? 'yes' : 'no',
        back: user.sprites.back ? 'yes' : 'no',
        left: user.sprites.left ? 'yes' : 'no',
        right: user.sprites.right ? 'yes' : 'no'
      } : 'none'
    });
    
    // Create as ROBOT (AI-controlled) so they can move around
    const facing = user.facing as { x: 0 | 1 | -1; y: 0 | 1 | -1 } | undefined;
    const robot: any = {
      ...createAvatar(user.userId, user.displayName || 'Anonymous', user.x, user.y, facing),
      kind: 'ROBOT', // Override to ROBOT so AI can control them
      sprites: user.sprites,
      stats: user.stats,
      direction: { x: 0, y: 0 },
      targetPosition: undefined,
      plannedPath: undefined
    };
    
    const result = world.addEntity(robot);
    if (result.ok) {
      loadedCount++;
    }
  }
  
  console.log(`Loaded ${loadedCount} existing users as ROBOTs`);
}


/**
 * Add a single NPC to the world dynamically (after server startup).
 * Called from the HTTP API when a new NPC is created.
 * If the NPC already exists, it will be updated with fresh data from the database.
 */
export async function addNpcToWorld(npcId: string): Promise<{ ok: boolean; error?: string }> {
  console.log(`[NPC] Adding/updating NPC ${npcId} in world...`);
  
  // Fetch from database
  const { data, error } = await supabase
    .from('user_positions')
    .select('user_id, x, y, facing_x, facing_y, display_name, has_avatar, sprite_front, sprite_back, sprite_left, sprite_right, conversation_state')
    .eq('user_id', npcId)
    .single();
  
  if (error || !data) {
    console.error(`[NPC] Failed to fetch NPC ${npcId}:`, error);
    return { ok: false, error: error?.message || 'NPC not found in database' };
  }
  
  // Fetch stats
  const { data: statsData } = await supabase
    .from('agent_state')
    .select('energy, hunger, loneliness, mood')
    .eq('avatar_id', npcId)
    .single();
  
  const sprites = (data.sprite_front || data.sprite_back || data.sprite_left || data.sprite_right) ? {
    front: data.sprite_front || undefined,
    back: data.sprite_back || undefined,
    left: data.sprite_left || undefined,
    right: data.sprite_right || undefined,
  } : undefined;
  
  console.log(`[NPC] Found NPC in database: ${data.display_name} at (${data.x}, ${data.y}), sprites: ${sprites ? 'yes' : 'no'}`);
  
  // Check if entity already exists
  const existingEntity = world.getEntity(npcId);
  if (existingEntity) {
    // Update the existing entity's sprites and display name
    console.log(`[NPC] Updating existing entity ${data.display_name}`);
    (existingEntity as any).sprites = sprites;
    (existingEntity as any).displayName = data.display_name || 'NPC';
    if (statsData) {
      (existingEntity as any).stats = {
        energy: statsData.energy,
        hunger: statsData.hunger,
        loneliness: statsData.loneliness,
        mood: statsData.mood
      };
    }
    return { ok: true };
  }
  
  // Create the robot entity
  const facing = { x: data.facing_x ?? 0, y: data.facing_y ?? 1 } as { x: 0 | 1 | -1; y: 0 | 1 | -1 };
  const robot: any = {
    ...createAvatar(data.user_id, data.display_name || 'NPC', data.x, data.y, facing),
    kind: 'ROBOT',
    sprites: sprites,
    stats: statsData ? {
      energy: statsData.energy,
      hunger: statsData.hunger,
      loneliness: statsData.loneliness,
      mood: statsData.mood
    } : undefined,
    direction: { x: 0, y: 0 },
    targetPosition: undefined,
    plannedPath: undefined
  };
  
  const result = world.addEntity(robot);
  if (result.ok) {
    console.log(`[NPC] Successfully added ${data.display_name} to world`);
    return { ok: true };
  } else {
    console.error(`[NPC] Failed to add entity:`, result.error);
    return { ok: false, error: String(result.error) };
  }
}


export function startGameLoop() {
  // Game Loop
  setInterval(async () => {
    const events = world.tick();
    if (events.length > 0) {
      broadcast({ type: 'EVENTS', events });
      
      // Handle CONVERSATION_STARTED events to initialize tracking for agent-agent conversations
      for (const event of events) {
        if (event.type === 'CONVERSATION_STARTED' && event.participant1Id && event.participant2Id) {
          const entity1 = world.getEntity(event.participant1Id);
          const entity2 = world.getEntity(event.participant2Id);
          
          // Only initialize for agent-agent (both ROBOT) conversations
          if (entity1?.kind === 'ROBOT' && entity2?.kind === 'ROBOT') {
            const { initializeConversationTracking } = await import('./handlers');
            await initializeConversationTracking(event.participant1Id, event.participant2Id);
            console.log(`[GameLoop] Initialized agent-agent conversation tracking: ${entity1.displayName} ↔ ${entity2.displayName}`);
          }
        }
      }
    }
  }, TICK_RATE);
}

// Track previous stats to only send updates when changed
const previousStats = new Map<string, { energy: number; hunger: number; loneliness: number; mood: number; current_action?: string }>();

/**
 * Sync agent stats from database and broadcast any changes to clients.
 * This runs periodically to keep clients updated with stats from the AI engine.
 * Also syncs current_action for activity visibility.
 */
export async function syncAgentStats(force: boolean = false) {
  const currentStats = await getAllAgentStats();
  const events: any[] = [];
  
  for (const [avatarId, stats] of currentStats) {
    const prev = previousStats.get(avatarId);
    
    // Check if stats or current_action changed
    const changed = force || !prev || 
      Math.abs(prev.energy - stats.energy) > 0.001 ||
      Math.abs(prev.hunger - stats.hunger) > 0.001 ||
      Math.abs(prev.loneliness - stats.loneliness) > 0.001 ||
      Math.abs(prev.mood - stats.mood) > 0.001 ||
      prev.current_action !== stats.current_action;
    
    if (changed) {
      previousStats.set(avatarId, {
        energy: stats.energy,
        hunger: stats.hunger,
        loneliness: stats.loneliness,
        mood: stats.mood,
        current_action: stats.current_action
      });
      events.push({
        type: 'ENTITY_STATS_UPDATED',
        entityId: avatarId,
        stats: {
          energy: stats.energy,
          hunger: stats.hunger,
          loneliness: stats.loneliness,
          mood: stats.mood,
          current_action: stats.current_action,
          current_action_target: stats.current_action_target
        }
      });
    }
  }
  
  if (events.length > 0) {
    console.log(`[StatsSync] Broadcasting ${events.length} stat updates`);
    broadcast({ type: 'EVENTS', events });
  }
}

export function startStatsSyncLoop() {
  // Sync stats every 1 second for immediate activity updates
  setInterval(syncAgentStats, 1000);
}

/**
 * Check for timed out conversations and end them automatically.
 * Called periodically to clean up stale conversations.
 */
export function checkConversationTimeouts() {
  const now = Date.now();
  
  for (const [participantId, convData] of activeConversations.entries()) {
    // Skip if we've already processed this conversation from the other participant
    if (!activeConversations.has(convData.participant1) && participantId === convData.participant2) {
      continue;
    }
    
    const timeSinceLastMessage = now - convData.lastMessageAt;
    
    if (timeSinceLastMessage >= CONVERSATION_TIMEOUT_MS) {
      console.log(`Conversation ${convData.conversationId} timed out after ${CONVERSATION_TIMEOUT_MS}ms of inactivity`);
      
      // End the conversation for both participants
      const entity1 = world.getEntity(convData.participant1);
      const entity2 = world.getEntity(convData.participant2);
      
      if (entity1?.conversationState === 'IN_CONVERSATION' || entity2?.conversationState === 'IN_CONVERSATION') {
        // Use participant1 to end the conversation (it will end for both)
        const result = world.endConversation(convData.participant1);
        if (result.ok) {
          broadcast({ type: 'EVENTS', events: result.value });
        }
        
        // Process the conversation end asynchronously
        processConversationEndAsync(convData);
      }
      
      // Clean up tracking
      activeConversations.delete(convData.participant1);
      activeConversations.delete(convData.participant2);
    }
  }
}

export async function processConversationEndAsync(convData: ActiveConversation) {
  const { API_BASE_URL } = await import('./config');
  const entity1 = world.getEntity(convData.participant1);
  const entity2 = world.getEntity(convData.participant2);
  const { userConnections } = await import('./state');
  
  console.log(`[ConvEndAsync] Processing: ${entity1?.displayName || 'Unknown'} & ${entity2?.displayName || 'Unknown'}`);
  console.log(`[ConvEndAsync] Messages: ${convData.messages.length}`);
  
  try {
    const response = await fetch(`${API_BASE_URL}/conversation/end-process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: convData.conversationId,
        participant_a: convData.participant1,
        participant_b: convData.participant2,
        participant_a_name: entity1?.displayName || 'Unknown',
        participant_b_name: entity2?.displayName || 'Unknown',
        transcript: convData.messages.map(m => ({
          senderId: m.senderId,
          senderName: m.senderName,
          content: m.content,
          timestamp: m.timestamp,
          isPlayerControlled: m.isPlayerControlled ?? false  // Pass the player control flag
        })),
        participant_a_is_online: userConnections.has(convData.participant1),
        participant_b_is_online: userConnections.has(convData.participant2)
      })
    });
    
    const result = await response.json();
    console.log(`[ConvEndAsync] API response:`, result);
    
    // Force sync stats immediately so UI updates
    console.log(`[ConvEndAsync] Forcing stats sync for UI update`);
    await syncAgentStats(true);
    
  } catch (e) {
    console.error('[ConvEndAsync] Error processing conversation end:', e);
  }
}

export function startConversationTimeoutLoop() {
  // Check for timed out conversations every 30 seconds
  setInterval(checkConversationTimeouts, 30000);
}

/**
 * Handle agent-agent conversations ONLY.
 * When two offline robots are in a conversation, they generate messages to each other.
 * 
 * IMPORTANT: This does NOT handle player-agent conversations.
 * Player-agent conversations are handled in handleChatMessage (handlers.ts)
 * where the player sends a message and gets ONE response from the agent.
 */
export async function processAgentAgentConversations() {
  const { userConnections } = await import('./state');
  
  // Debug: Log active conversation count on every run
  const activeCount = activeConversations.size / 2; // Each conversation has 2 entries
  if (activeCount > 0) {
    console.log(`[Agent-Agent] Active conversations: ${activeCount}`);
    for (const [participantId, convData] of activeConversations.entries()) {
      if (participantId === convData.participant1) { // Only log once per conversation
        const e1 = world.getEntity(convData.participant1);
        const e2 = world.getEntity(convData.participant2);
        console.log(`  - ${e1?.displayName || 'Unknown'} ↔ ${e2?.displayName || 'Unknown'}: ${convData.messages.length} msgs, states: ${e1?.conversationState}/${e2?.conversationState}`);
      }
    }
  }
  
  // Process each active conversation
  const processedConversations = new Set<string>();
  
  for (const [participantId, convData] of activeConversations.entries()) {
    // Skip if we've already processed this conversation in this tick
    if (processedConversations.has(convData.conversationId)) continue;
    processedConversations.add(convData.conversationId);
    
    // Skip if this conversation is currently being processed (API call in flight)
    if (conversationsBeingProcessed.has(convData.conversationId)) continue;
    
    const entity1 = world.getEntity(convData.participant1);
    const entity2 = world.getEntity(convData.participant2);
    
    // Skip if either entity doesn't exist or isn't in conversation
    if (!entity1 || !entity2) {
      console.log(`[Agent-Agent] Skipping - entity missing: e1=${!!entity1} e2=${!!entity2}`);
      continue;
    }
    if (entity1.conversationState !== 'IN_CONVERSATION') {
      console.log(`[Agent-Agent] Skipping - ${entity1.displayName} state: ${entity1.conversationState}`);
      continue;
    }
    if (entity2.conversationState !== 'IN_CONVERSATION') {
      console.log(`[Agent-Agent] Skipping - ${entity2.displayName} state: ${entity2.conversationState}`);
      continue;
    }
    
    const isEntity1Online = userConnections.has(convData.participant1);
    const isEntity2Online = userConnections.has(convData.participant2);
    
    // CRITICAL: If ANY participant is an online player, skip this conversation entirely.
    // Player-agent conversations are turn-based and handled via handleChatMessage.
    // This loop ONLY handles agent-agent (both offline robots) conversations.
    if (isEntity1Online || isEntity2Online) {
      console.log(`[Agent-Agent] Skipping - player online: e1=${isEntity1Online} e2=${isEntity2Online}`);
      continue;
    }
    
    // Both must be offline ROBOTs for this loop to generate messages
    const isEntity1Robot = entity1.kind === 'ROBOT';
    const isEntity2Robot = entity2.kind === 'ROBOT';
    
    if (!isEntity1Robot || !isEntity2Robot) {
      console.log(`[Agent-Agent] Skipping - not both robots: e1=${entity1.kind} e2=${entity2.kind}`);
      continue;
    }
    
    // Rate limit: only send messages every 2-3 seconds (faster for more active conversations)
    const timeSinceLastMessage = Date.now() - convData.lastMessageAt;
    const minInterval = 2000 + Math.random() * 1000; // 2-3 seconds
    if (timeSinceLastMessage < minInterval) continue;
    
    // Determine who should speak next (alternate, or the one who didn't speak last)
    const lastMessage = convData.messages[convData.messages.length - 1];
    const nextSpeakerId = lastMessage 
      ? (lastMessage.senderId === convData.participant1 ? convData.participant2 : convData.participant1)
      : convData.participant1;
    
    // IMPORTANT: Never generate AI messages for entities controlled by human players
    // If the next speaker is online, they're a human - let them speak themselves
    const isNextSpeakerOnline = userConnections.has(nextSpeakerId);
    if (isNextSpeakerOnline) continue;
    
    const speaker = nextSpeakerId === convData.participant1 ? entity1 : entity2;
    const listener = nextSpeakerId === convData.participant1 ? entity2 : entity1;
    const listenerId = nextSpeakerId === convData.participant1 ? convData.participant2 : convData.participant1;
    
    // Mark conversation as being processed to prevent duplicate API calls
    conversationsBeingProcessed.add(convData.conversationId);
    
    // Generate response from the speaker (agent only)
    const isFirstMessage = convData.messages.length === 0;
    try {
      const response = await generateAgentMessage(
        nextSpeakerId,
        listenerId,
        listener.displayName || 'Unknown',
        convData.messages,
        isFirstMessage
      );
      
      if (response) {
        // Generate a unique message ID with clear identifiers
        const messageId = `msg-${convData.conversationId.substring(0, 8)}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        
        // Agent-agent messages are NOT player controlled (all LLM generated)
        const message: ChatMessage = {
          id: messageId,
          senderId: nextSpeakerId,
          senderName: speaker.displayName || 'Agent',
          content: response,
          timestamp: Date.now(),
          conversationId: convData.conversationId,
          isPlayerControlled: false  // Agent-to-agent is all LLM
        };
        
        console.log(`[Agent-Agent] Message created: id=${messageId.substring(0, 20)}, sender=${speaker.displayName} (${nextSpeakerId.substring(0, 8)}), conv=${convData.conversationId.substring(0, 8)}`);
        
        convData.messages.push(message);
        convData.lastMessageAt = Date.now();
        
        // Broadcast to ALL clients (players + spectators) so everyone sees agent-agent chat bubbles
        const chatEvent = {
          type: 'CHAT_MESSAGE' as const,
          messageId: message.id,
          senderId: message.senderId,
          senderName: message.senderName,
          content: message.content,
          timestamp: message.timestamp,
          conversationId: convData.conversationId
        };
        console.log(`[Agent-Agent] Broadcasting chat: ${message.senderName} → "${message.content.substring(0, 30)}..."`);
        broadcast(chatEvent);
        
        console.log(`[Agent-Agent] ${speaker.displayName} → ${listener.displayName}: ${response.substring(0, 50)}...`);
        
        // Check if the speaker wants to end the conversation
        // (based on sentiment, conversation flow, rudeness, etc.)
        const shouldEnd = await checkShouldEndConversation(
          nextSpeakerId,
          speaker.displayName || 'Agent',
          listenerId,
          listener.displayName || 'Agent',
          convData.messages,
          response
        );
        
        if (shouldEnd.should_end) {
          console.log(`[Agent-Agent] ${speaker.displayName} chose to END conversation: ${shouldEnd.reason}`);
          
          // Send farewell message if provided
          if (shouldEnd.farewell_message) {
            const farewellMsg: ChatMessage = {
              id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              senderId: nextSpeakerId,
              senderName: speaker.displayName || 'Agent',
              content: shouldEnd.farewell_message,
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
            console.log(`[Agent-Agent] Broadcasting farewell: ${farewellMsg.senderName} → "${farewellMsg.content.substring(0, 30)}..."`);
            broadcast(farewellEvent);
          }
          
          // Pass reason and who ended it for notifications
          const result = world.endConversation(
            convData.participant1, 
            speaker.displayName || 'Agent', 
            shouldEnd.reason
          );
          if (result.ok) {
            broadcast({ type: 'EVENTS', events: result.value });
          }
          processConversationEndAsync(convData);
          activeConversations.delete(convData.participant1);
          activeConversations.delete(convData.participant2);
        } else {
          // Fallback: End conversation after moderate exchanges (8-12 messages)
          // This keeps agents active - they don't get stuck in long conversations
          const maxMessages = 8 + Math.floor(Math.random() * 5);
          if (convData.messages.length >= maxMessages) {
            console.log(`[Agent-Agent] Conversation ending after ${convData.messages.length} messages (max reached)`);
            const result = world.endConversation(convData.participant1);
            if (result.ok) {
              broadcast({ type: 'EVENTS', events: result.value });
            }
            processConversationEndAsync(convData);
            activeConversations.delete(convData.participant1);
            activeConversations.delete(convData.participant2);
          }
        }
      }
    } catch (e) {
      console.error('Error in agent-agent conversation:', e);
    } finally {
      // Always release the lock
      conversationsBeingProcessed.delete(convData.conversationId);
    }
  }
}

async function generateAgentMessage(
  agentId: string,
  partnerId: string,
  partnerName: string,
  messages: ChatMessage[],
  isFirstMessage: boolean = false
): Promise<string | null> {
  try {
    const lastMessage = messages[messages.length - 1];
    
    // For first message, use a greeting prompt instead of a reply context
    const messagePrompt = isFirstMessage 
      ? `[START NEW CONVERSATION] Greet ${partnerName} and start a friendly conversation.`
      : (lastMessage?.content || 'Hi there!');
    
    console.log(`[generateAgentMessage] Agent ${agentId.substring(0, 8)} responding to "${messagePrompt.substring(0, 50)}..." (first=${isFirstMessage})`);
    
    const response = await fetch(`${API_BASE_URL}/conversation/agent-respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: messages[0]?.conversationId || `conv-${Date.now()}`,
        agent_id: agentId,
        partner_id: partnerId,
        partner_name: partnerName,
        message: messagePrompt,
        conversation_history: messages.map(m => ({
          senderId: m.senderId,
          senderName: m.senderName,
          content: m.content,
          timestamp: m.timestamp
        }))
      })
    });
    const data = await response.json();
    
    if (data.ok && data.response) {
      console.log(`[generateAgentMessage] Got response: "${data.response.substring(0, 50)}..."`);
      return data.response;
    } else {
      console.error(`[generateAgentMessage] API returned error:`, data.error);
      return null;
    }
  } catch (e) {
    console.error('[generateAgentMessage] Error:', e);
    return null;
  }
}

export function startAgentAgentConversationLoop() {
  // Process agent-agent conversations every 2 seconds
  setInterval(processAgentAgentConversations, 2000);
  
  // Log active conversations periodically for debugging
  setInterval(() => {
    if (activeConversations.size > 0) {
      console.log(`[Agent-Agent] Active conversations: ${activeConversations.size / 2}`);
    }
  }, 30000);
}

export function startAiLoop() {
  // AI Loop
  setInterval(async () => {
    const snapshot = world.getSnapshot();
    const robots = snapshot.entities.filter(e => e.kind === 'ROBOT');
    const currentTime = Date.now();
    
    for (const robot of robots) {
      // SAFETY CHECK: Ensure we're only processing ROBOT entities
      if (robot.kind !== 'ROBOT') {
        console.error(`ERROR: AI loop tried to process non-ROBOT entity: ${robot.entityId} (kind: ${robot.kind})`);
        continue;
      }
      
      // Skip if robot is on a decision cooldown (e.g. standing still for a duration)
      if (robot.nextDecisionAt && currentTime < robot.nextDecisionAt) {
        continue;
      }
      
      // Skip if robot is in any conversation-related state (they should be doing conversation things)
      if (robot.conversationState === 'IN_CONVERSATION') {
        continue;
      }
      
      // Skip if robot has a pending conversation request (waiting for response)
      if (robot.conversationState === 'PENDING_REQUEST') {
        continue;
      }
      
      // Skip if robot is walking to a conversation partner
      if (robot.conversationState === 'WALKING_TO_CONVERSATION') {
        continue;
      }
      
      // Get pending conversation requests for this robot
      const pendingRequests = world.getPendingRequestsFor(robot.entityId);
      
      // Get nearby entities for conversation initiation
      const nearbyEntities = world.getEntitiesInRange(robot.entityId);
      
      // If robot has no target, ask API for next action
      // Note: We've already checked for conversation-related states above, so this is a general check
      if (!robot.targetPosition) {
        // ============================================================
        // 🧪 PATHFINDING TEST - Uncomment to test automatic walking
        // ============================================================
        // const TEST_TARGET = { x: 30, y: 20 };  // Change to your desired coordinate
        // const obstacles = new Set<string>();
        // for (const e of snapshot.entities) {
        //   if (e.entityId !== robot.entityId) {
        //     obstacles.add(`${e.x},${e.y}`);
        //     obstacles.add(`${e.x + 1},${e.y}`);
        //   }
        // }
        // const path = findPath(MAIN_MAP, { x: robot.x, y: robot.y }, TEST_TARGET, obstacles);
        // if (path) {
        //   console.log(`🤖 [PATHFINDING TEST] ${robot.displayName} walking to (${TEST_TARGET.x}, ${TEST_TARGET.y}) - ${path.length} steps`);
        //   world.setTarget(robot.entityId, TEST_TARGET.x, TEST_TARGET.y);
        //   continue;
        // }
        // ============================================================
        
        try {
          const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              robot_id: robot.entityId,
              x: robot.x,
              y: robot.y,
              map_width: MAP_WIDTH,
              map_height: MAP_HEIGHT,
              conversation_state: robot.conversationState || 'IDLE',
              nearby_entities: nearbyEntities.map(e => ({
                entityId: e.entityId,
                kind: e.kind,
                x: e.x,
                y: e.y,
                displayName: e.displayName
              })),
              pending_requests: pendingRequests.map(r => ({
                request_id: r.requestId,
                initiator_id: r.initiatorId,
                initiator_type: r.initiatorType,
                created_at: r.createdAt,
                expires_at: r.expiresAt
              }))
            })
          });
          
          if (res.ok) {
            const data = await res.json();
            
            // Handle different action types
            switch (data.action) {
              case 'MOVE':
                if (data.target_x !== undefined && data.target_y !== undefined) {
                  world.setEntityTarget(robot.entityId, { x: data.target_x, y: data.target_y });
                }
                break;
                
              case 'STAND_STILL':
                if (data.duration) {
                  world.setEntityNextDecision(robot.entityId, currentTime + (data.duration * 1000));
                }
                break;
                
              case 'REQUEST_CONVERSATION':
                if (data.target_entity_id) {
                  // Check if agent WANTS to initiate based on sentiment, interests, mood
                  const targetEntity = world.getEntity(data.target_entity_id);
                  
                  // First check if either party is already busy
                  const currentRobot = world.getEntity(robot.entityId);
                  if (currentRobot?.conversationState && currentRobot.conversationState !== 'IDLE') {
                    console.log(`[Agent] ${robot.displayName} already busy (${currentRobot.conversationState}), skipping request`);
                    break;
                  }
                  if (targetEntity?.conversationState && targetEntity.conversationState !== 'IDLE') {
                    console.log(`[Agent] Target ${targetEntity?.displayName} is busy (${targetEntity?.conversationState}), skipping request`);
                    break;
                  }
                  
                  const initiateResult = await checkShouldInitiateConversation(
                    robot.entityId,
                    robot.displayName || 'Agent',
                    data.target_entity_id,
                    targetEntity?.displayName || 'Unknown'
                  );
                  
                  if (!initiateResult.should_initiate) {
                    console.log(`[Agent] ${robot.displayName} decided NOT to initiate conversation with ${targetEntity?.displayName}`);
                    // Set a small cooldown to prevent immediate re-request
                    world.setEntityNextDecision(robot.entityId, currentTime + 2000);
                    break;
                  }
                  
                  // Request conversation with the reason from the AI
                  const result = world.requestConversation(robot.entityId, data.target_entity_id, initiateResult.reason);
                  if (result.ok) {
                    console.log(`[Agent] ${robot.displayName} → ${targetEntity?.displayName}: Request sent!`);
                    broadcast({ type: 'EVENTS', events: result.value });
                  } else {
                    console.log(`[Agent] ${robot.displayName} → ${targetEntity?.displayName}: Request FAILED: ${result.error.message}`);
                    // Set a cooldown to prevent spam
                    world.setEntityNextDecision(robot.entityId, currentTime + 3000);
                  }
                }
                break;
                
              case 'ACCEPT_CONVERSATION':
                if (data.request_id) {
                  // First, check if the agent WANTS to accept based on sentiment
                  const pendingReq = pendingRequests.find(r => r.requestId === data.request_id);
                  if (pendingReq) {
                    const initiatorEntity = world.getEntity(pendingReq.initiatorId);
                    const acceptResult = await checkShouldAcceptConversation(
                      robot.entityId,
                      robot.displayName || 'Agent',
                      pendingReq.initiatorId,
                      initiatorEntity?.displayName || 'Unknown'
                    );
                    
                    if (!acceptResult.should_accept) {
                      // Agent decided to reject based on sentiment/mood - include reason
                      console.log(`[Agent] ${robot.displayName} REJECTED conversation from ${initiatorEntity?.displayName}: ${acceptResult.reason}`);
                      const rejectResult = world.rejectConversation(robot.entityId, data.request_id, acceptResult.reason);
                      if (rejectResult.ok) {
                        broadcast({ type: 'EVENTS', events: rejectResult.value });
                      }
                      break;
                    }
                    
                    // Accept with reason
                    const result = world.acceptConversation(robot.entityId, data.request_id, acceptResult.reason);
                    if (result.ok) {
                      broadcast({ type: 'EVENTS', events: result.value });
                      
                      // Initialize conversation tracking for agent-agent conversations
                      const updatedRobot = world.getEntity(robot.entityId);
                      const partnerId = updatedRobot?.conversationTargetId || updatedRobot?.conversationPartnerId;
                      if (partnerId) {
                        const { initializeConversationTracking } = await import('./handlers');
                        await initializeConversationTracking(robot.entityId, partnerId);
                        console.log(`[Agent] Initialized conversation tracking: ${robot.entityId.substring(0, 8)} with ${partnerId.substring(0, 8)}`);
                      }
                    }
                  } else {
                    // No pending request found, just accept without extra checks
                    const result = world.acceptConversation(robot.entityId, data.request_id);
                    if (result.ok) {
                      broadcast({ type: 'EVENTS', events: result.value });
                    }
                  }
                }
                break;
                
              case 'REJECT_CONVERSATION':
                if (data.request_id) {
                  const reason = data.reason || 'Not interested in chatting right now';
                  console.log(`[AI Reject] ${robot.displayName} rejecting conversation: ${reason}`);
                  const result = world.rejectConversation(robot.entityId, data.request_id, reason);
                  if (result.ok) {
                    broadcast({ type: 'EVENTS', events: result.value });
                  }
                }
                break;
            }
          }
        } catch (e) {
          // console.error('Failed to get AI decision:', e);
        }
      }
    }
  }, AI_TICK_RATE);
}
