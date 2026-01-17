import { World, createMapDef, createWall, CONVERSATION_CONFIG } from '../../world/index.ts';
import { MAP_WIDTH, MAP_HEIGHT, TICK_RATE, AI_TICK_RATE, API_URL } from './config';
import { broadcast } from './network';

export const world = new World(createMapDef(MAP_WIDTH, MAP_HEIGHT));

// Add some walls
world.addEntity(createWall('wall-1', 10, 10));
world.addEntity(createWall('wall-2', 10, 12));
world.addEntity(createWall('wall-3', 10, 14));
world.addEntity(createWall('wall-4', 12, 10));


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
