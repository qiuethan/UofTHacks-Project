import { World, createMapDef, createWall, createAvatar, CONVERSATION_CONFIG } from '../../world/index.ts';
import { MAP_WIDTH, MAP_HEIGHT, TICK_RATE, AI_TICK_RATE, API_URL, CONVERSATION_TIMEOUT_MS, API_BASE_URL } from './config';
import { broadcast } from './network';
import { generateWallPositions, INDIVIDUAL_WALLS } from './walls';
import { getAllUsers } from './db';
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

// Lock to prevent concurrent processing of the same conversation
const conversationsBeingProcessed = new Set<string>();

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

async function processConversationEndAsync(convData: ActiveConversation) {
  const { API_BASE_URL } = await import('./config');
  const entity1 = world.getEntity(convData.participant1);
  const entity2 = world.getEntity(convData.participant2);
  const { userConnections } = await import('./state');
  
  try {
    await fetch(`${API_BASE_URL}/conversation/end-process`, {
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
          timestamp: m.timestamp
        })),
        participant_a_is_online: userConnections.has(convData.participant1),
        participant_b_is_online: userConnections.has(convData.participant2)
      })
    });
  } catch (e) {
    console.error('Error processing timed-out conversation end:', e);
  }
}

export function startConversationTimeoutLoop() {
  // Check for timed out conversations every 30 seconds
  setInterval(checkConversationTimeouts, 30000);
}

/**
 * Handle agent-agent conversations.
 * When two robots are in a conversation, they generate messages to each other.
 */
export async function processAgentAgentConversations() {
  const { userConnections } = await import('./state');
  const { sendToUser } = await import('./network');
  
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
    if (!entity1 || !entity2) continue;
    if (entity1.conversationState !== 'IN_CONVERSATION') continue;
    if (entity2.conversationState !== 'IN_CONVERSATION') continue;
    
    const isEntity1Online = userConnections.has(convData.participant1);
    const isEntity2Online = userConnections.has(convData.participant2);
    
    // Process conversations where at least one is a ROBOT
    // This allows agent-agent AND agent-player-offline conversations
    const isEntity1Robot = entity1.kind === 'ROBOT' && !isEntity1Online;
    const isEntity2Robot = entity2.kind === 'ROBOT' && !isEntity2Online;
    
    // Skip if both are online players (they chat via handleChatMessage)
    if (isEntity1Online && isEntity2Online) continue;
    
    // At least one must be an offline robot for us to generate messages
    if (!isEntity1Robot && !isEntity2Robot) continue;
    
    // Rate limit: only send messages every 3-5 seconds
    const timeSinceLastMessage = Date.now() - convData.lastMessageAt;
    const minInterval = 3000 + Math.random() * 2000; // 3-5 seconds
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
    
    // Generate response from the speaker
    try {
      const response = await generateAgentMessage(
        nextSpeakerId,
        listenerId,
        listener.displayName || 'Unknown',
        convData.messages
      );
      
      if (response) {
        const message: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          senderId: nextSpeakerId,
          senderName: speaker.displayName || 'Agent',
          content: response,
          timestamp: Date.now(),
          conversationId: convData.conversationId
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
        
        // End conversation after a few exchanges (5-10 messages)
        const maxMessages = 5 + Math.floor(Math.random() * 5);
        if (convData.messages.length >= maxMessages) {
          console.log(`[Agent-Agent] Conversation ending after ${convData.messages.length} messages`);
          const result = world.endConversation(convData.participant1);
          if (result.ok) {
            broadcast({ type: 'EVENTS', events: result.value });
          }
          processConversationEndAsync(convData);
          activeConversations.delete(convData.participant1);
          activeConversations.delete(convData.participant2);
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
