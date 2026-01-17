import { World, createMapDef, createWall, createRobot } from '../../world/index.ts';
import { MAP_WIDTH, MAP_HEIGHT, TICK_RATE, AI_TICK_RATE, API_URL } from './config';
import { broadcast } from './network';

export const world = new World(createMapDef(MAP_WIDTH, MAP_HEIGHT));

// Add some walls
world.addEntity(createWall('wall-1', 5, 5));
world.addEntity(createWall('wall-2', 5, 6));
world.addEntity(createWall('wall-3', 5, 7));
world.addEntity(createWall('wall-4', 6, 5));

// Add a robot
world.addEntity(createRobot('robot-1', 10, 10));

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
    
    for (const robot of robots) {
      // If robot has no target (or we want to re-evaluate), ask API
      if (!robot.targetPosition) {
        try {
          const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              robot_id: robot.entityId,
              x: robot.x,
              y: robot.y,
              map_width: MAP_WIDTH,
              map_height: MAP_HEIGHT
            })
          });
          
          if (res.ok) {
            const data = await res.json();
            world.setEntityTarget(robot.entityId, { x: data.target_x, y: data.target_y });
          }
        } catch (e) {
          // console.error('Failed to get AI decision:', e);
        }
      }
    }
  }, AI_TICK_RATE);
}
