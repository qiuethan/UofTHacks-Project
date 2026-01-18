import { World, createMapDef, createWall, createAvatar, CONVERSATION_CONFIG } from '../../world/index.ts';
import { MAP_WIDTH, MAP_HEIGHT, TICK_RATE, AI_TICK_RATE, API_URL, CONVERSATION_TIMEOUT_MS, API_BASE_URL } from './config';
import { broadcast } from './network';
import { generateWallPositions, INDIVIDUAL_WALLS } from './walls';
import { getAllUsers, getAllAgentStats } from './db';
import type { ChatMessage } from './types';

export const world = new World(createMapDef(MAP_WIDTH, MAP_HEIGHT));

// Track active conversations for chat messages
export interface ActiveConversation {
  conversationId: string;
  participant1: string;
  participant2: string;
  messages: ChatMessage[];
  lastMessageAt: number;
}

export const activeConversations = new Map<string, ActiveConversation>();

// ============================================================================
// AGENT DECISION HELPERS
// ============================================================================

interface ShouldEndResult {
  should_end: boolean;
  farewell_message?: string;
  reason?: string;
}

/**
 * Check if an agent should accept a conversation request.
 * Based on sentiment, mood, energy, and relationship with requester.
 */
async function checkShouldAcceptConversation(
  agentId: string,
  agentName: string,
  requesterId: string,
  requesterName: string
): Promise<boolean> {
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
    return data.should_accept !== false; // Default to accept if API fails
  } catch (e) {
    console.error('Error checking should-accept:', e);
    return true; // Default to accept on error
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


export function startGameLoop() {
  // Game Loop
  setInterval(() => {
    const events = world.tick();
    if (events.length > 0) {
      broadcast({ type: 'EVENTS', events });
    }
  }, TICK_RATE);
}

// Track previous stats to only send updates when changed
const previousStats = new Map<string, { energy: number; hunger: number; loneliness: number; mood: number }>();

/**
 * Sync agent stats from database and broadcast any changes to clients.
 * This runs periodically to keep clients updated with stats from the AI engine.
 */
export async function syncAgentStats(force: boolean = false) {
  const currentStats = await getAllAgentStats();
  const events: any[] = [];
  
  for (const [avatarId, stats] of currentStats) {
    const prev = previousStats.get(avatarId);
    
    // Check if stats changed (with some tolerance for floating point)
    const changed = force || !prev || 
      Math.abs(prev.energy - stats.energy) > 0.001 ||
      Math.abs(prev.hunger - stats.hunger) > 0.001 ||
      Math.abs(prev.loneliness - stats.loneliness) > 0.001 ||
      Math.abs(prev.mood - stats.mood) > 0.001;
    
    if (changed) {
      previousStats.set(avatarId, stats);
      events.push({
        type: 'ENTITY_STATS_UPDATED',
        entityId: avatarId,
        stats
      });
    }
  }
  
  if (events.length > 0) {
    console.log(`[StatsSync] Broadcasting ${events.length} stat updates`);
    broadcast({ type: 'EVENTS', events });
  }
}

export function startStatsSyncLoop() {
  // Sync stats every 2 seconds
  setInterval(syncAgentStats, 2000);
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
  
  // Process each active conversation
  const processedConversations = new Set<string>();
  
  for (const [participantId, convData] of activeConversations.entries()) {
    // Skip if we've already processed this conversation
    if (processedConversations.has(convData.conversationId)) continue;
    processedConversations.add(convData.conversationId);
    
    const entity1 = world.getEntity(convData.participant1);
    const entity2 = world.getEntity(convData.participant2);
    
    // Skip if either entity doesn't exist or isn't in conversation
    if (!entity1 || !entity2) continue;
    if (entity1.conversationState !== 'IN_CONVERSATION') continue;
    if (entity2.conversationState !== 'IN_CONVERSATION') continue;
    
    const isEntity1Online = userConnections.has(convData.participant1);
    const isEntity2Online = userConnections.has(convData.participant2);
    
    // CRITICAL: If ANY participant is an online player, skip this conversation entirely.
    // Player-agent conversations are turn-based and handled via handleChatMessage.
    // This loop ONLY handles agent-agent (both offline robots) conversations.
    if (isEntity1Online || isEntity2Online) continue;
    
    // Both must be offline ROBOTs for this loop to generate messages
    const isEntity1Robot = entity1.kind === 'ROBOT';
    const isEntity2Robot = entity2.kind === 'ROBOT';
    
    if (!isEntity1Robot || !isEntity2Robot) continue;
    
    // Rate limit: only send messages every 3-5 seconds
    const timeSinceLastMessage = Date.now() - convData.lastMessageAt;
    const minInterval = 3000 + Math.random() * 2000; // 3-5 seconds
    if (timeSinceLastMessage < minInterval) continue;
    
    // Determine who should speak next (alternate, or the one who didn't speak last)
    const lastMessage = convData.messages[convData.messages.length - 1];
    const nextSpeakerId = lastMessage 
      ? (lastMessage.senderId === convData.participant1 ? convData.participant2 : convData.participant1)
      : convData.participant1;
    
    const speaker = nextSpeakerId === convData.participant1 ? entity1 : entity2;
    const listener = nextSpeakerId === convData.participant1 ? entity2 : entity1;
    const listenerId = nextSpeakerId === convData.participant1 ? convData.participant2 : convData.participant1;
    
    // Generate response from the speaker (agent only)
    try {
      const response = await generateAgentMessage(
        nextSpeakerId,
        listenerId,
        listener.displayName || 'Unknown',
        convData.messages
      );
      
      if (response) {
        // Agent-agent messages are NOT player controlled (all LLM generated)
        const message: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          senderId: nextSpeakerId,
          senderName: speaker.displayName || 'Agent',
          content: response,
          timestamp: Date.now(),
          conversationId: convData.conversationId,
          isPlayerControlled: false  // Agent-to-agent is all LLM
        };
        
        convData.messages.push(message);
        convData.lastMessageAt = Date.now();
        
        // Broadcast to any spectators (watch mode)
        const chatEvent = {
          type: 'CHAT_MESSAGE' as const,
          messageId: message.id,
          senderId: message.senderId,
          senderName: message.senderName,
          content: message.content,
          timestamp: message.timestamp,
          conversationId: convData.conversationId
        };
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
            broadcast({
              type: 'CHAT_MESSAGE' as const,
              messageId: farewellMsg.id,
              senderId: farewellMsg.senderId,
              senderName: farewellMsg.senderName,
              content: farewellMsg.content,
              timestamp: farewellMsg.timestamp,
              conversationId: convData.conversationId
            });
          }
          
          const result = world.endConversation(convData.participant1);
          if (result.ok) {
            broadcast({ type: 'EVENTS', events: result.value });
          }
          processConversationEndAsync(convData);
          activeConversations.delete(convData.participant1);
          activeConversations.delete(convData.participant2);
        } else {
          // Fallback: End conversation after many exchanges (15-20 messages)
          const maxMessages = 15 + Math.floor(Math.random() * 5);
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
    }
  }
}

async function generateAgentMessage(
  agentId: string,
  partnerId: string,
  partnerName: string,
  messages: ChatMessage[]
): Promise<string | null> {
  try {
    const lastMessage = messages[messages.length - 1];
    const response = await fetch(`${API_BASE_URL}/conversation/agent-respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: messages[0]?.conversationId || '',
        agent_id: agentId,
        partner_id: partnerId,
        partner_name: partnerName,
        message: lastMessage?.content || 'Hi there!',
        conversation_history: messages.map(m => ({
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
    console.error('Error generating agent message:', e);
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
      
      // Skip if robot is in conversation (they stand still)
      if (robot.conversationState === 'IN_CONVERSATION') {
        continue;
      }
      
      // Skip if robot has a pending conversation request (waiting for response)
      if (robot.conversationState === 'PENDING_REQUEST') {
        continue;
      }
      
      // Get pending conversation requests for this robot
      const pendingRequests = world.getPendingRequestsFor(robot.entityId);
      
      // Get nearby entities for conversation initiation
      const nearbyEntities = world.getEntitiesInRange(robot.entityId);
      
      // If robot has no target and is not in a conversation flow, ask API
      if (!robot.targetPosition && robot.conversationState !== 'WALKING_TO_CONVERSATION') {
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
                initiator_type: r.initiatorType
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
                  const result = world.requestConversation(robot.entityId, data.target_entity_id);
                  if (result.ok) {
                    broadcast({ type: 'EVENTS', events: result.value });
                  }
                }
                break;
                
              case 'ACCEPT_CONVERSATION':
                if (data.request_id) {
                  // First, check if the agent WANTS to accept based on sentiment
                  const pendingReq = pendingRequests.find(r => r.requestId === data.request_id);
                  if (pendingReq) {
                    const initiatorEntity = world.getEntity(pendingReq.initiatorId);
                    const shouldAccept = await checkShouldAcceptConversation(
                      robot.entityId,
                      robot.displayName || 'Agent',
                      pendingReq.initiatorId,
                      initiatorEntity?.displayName || 'Unknown'
                    );
                    
                    if (!shouldAccept) {
                      // Agent decided to reject based on sentiment/mood
                      console.log(`[Agent] ${robot.displayName} REJECTED conversation from ${initiatorEntity?.displayName} (negative sentiment)`);
                      const rejectResult = world.rejectConversation(robot.entityId, data.request_id);
                      if (rejectResult.ok) {
                        broadcast({ type: 'EVENTS', events: rejectResult.value });
                      }
                      break;
                    }
                  }
                  
                  const result = world.acceptConversation(robot.entityId, data.request_id);
                  if (result.ok) {
                    broadcast({ type: 'EVENTS', events: result.value });
                    
                    // Initialize conversation tracking for agent-agent conversations
                    // Use conversationTargetId since partnerId is only set when conversation starts
                    const updatedRobot = world.getEntity(robot.entityId);
                    const partnerId = updatedRobot?.conversationTargetId || updatedRobot?.conversationPartnerId;
                    if (partnerId) {
                      const { initializeConversationTracking } = await import('./handlers');
                      await initializeConversationTracking(robot.entityId, partnerId);
                      console.log(`[Agent] Initialized conversation tracking: ${robot.entityId.substring(0, 8)} with ${partnerId.substring(0, 8)}`);
                    }
                  }
                }
                break;
                
              case 'REJECT_CONVERSATION':
                if (data.request_id) {
                  const result = world.rejectConversation(robot.entityId, data.request_id);
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
