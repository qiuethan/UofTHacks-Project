import { World, createMapDef, createWall, createAvatar, CONVERSATION_CONFIG } from '../../world/index.ts';
import { MAP_WIDTH, MAP_HEIGHT, TICK_RATE, AI_TICK_RATE, API_URL } from './config';
import { broadcast } from './network';
import { generateWallPositions, INDIVIDUAL_WALLS } from './walls';
import { getAllUsers } from './db';

export const world = new World(createMapDef(MAP_WIDTH, MAP_HEIGHT));

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
