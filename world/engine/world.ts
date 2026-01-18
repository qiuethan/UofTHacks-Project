// ============================================================================
// WORLD ENGINE - The main API for interacting with the simulation
// ============================================================================

import type { Entity } from '../entities/entity';
import type { MapDef } from '../map/mapDef';
import type { WorldState } from '../state/worldState';
import type { WorldAction, WorldEvent, Result } from '../actions/types';
import { ok, err } from '../actions/types';
import { createWorldState, getAllEntities } from '../state/worldState';
import { createEntity } from '../entities/entity';
import { clampToBounds } from '../map/mapDef';
import { processAction } from '../actions/pipeline';
import { findPath } from '../utils/pathfinding';
import { ReservationTable, resolveMoves, type MoveProposal } from '../utils/reservations';
import { PATHFINDING_CONFIG } from './entityMovement';
import { 
  ConversationRequestManager, 
  isWithinInitiationRange, 
  isWithinConversationRange,
  areAdjacent,
  getDistance,
  CONVERSATION_CONFIG,
  type ConversationRequest 
} from '../utils/conversation';

// ============================================================================
// SNAPSHOT TYPE
// ============================================================================

export interface WorldSnapshot {
  readonly map: MapDef;
  readonly entities: readonly Entity[];
}

// ============================================================================
// WORLD CLASS
// ============================================================================

/**
 * World is the SINGLE SOURCE OF TRUTH for the simulation.
 * 
 * Invariants:
 * - All operations are synchronous
 * - All operations are deterministic
 * - The world never throws - errors are returned as Result
 * - Human and AI actors are treated identically
 */
export class World {
  private state: WorldState;
  private conversationRequests = new ConversationRequestManager();
  private activeConversations = new Map<string, { participant1Id: string; participant2Id: string; startedAt: number }>();

  constructor(mapDef: MapDef) {
    this.state = createWorldState(mapDef);
  }

  /**
   * Add an entity to the world.
   * Entity position is clamped to map bounds.
   * Returns ENTITY_JOINED event on success.
   */
  addEntity(entity: Entity): Result<WorldEvent[]> {
    // Check for duplicate
    if (this.state.entities.has(entity.entityId)) {
      return err(
        'ENTITY_EXISTS',
        `Entity ${entity.entityId} already exists in the world`
      );
    }

    // Clamp position to map bounds
    const clamped = clampToBounds(this.state.map, entity.x, entity.y);
    const clampedEntity: Entity = {
      ...entity,
      x: clamped.x,
      y: clamped.y
    };

    // Add to state
    this.state.entities.set(clampedEntity.entityId, clampedEntity);

    // Return event
    const event: WorldEvent = {
      type: 'ENTITY_JOINED',
      entity: clampedEntity,
    };

    return ok([event]);
  }

  /**
   * Remove an entity from the world.
   * Returns ENTITY_LEFT event on success.
   */
  removeEntity(entityId: string): Result<WorldEvent[]> {
    // Check existence
    if (!this.state.entities.has(entityId)) {
      return err(
        'ENTITY_NOT_FOUND',
        `Entity ${entityId} does not exist in the world`
      );
    }

    // Remove from state
    this.state.entities.delete(entityId);

    // Return event
    const event: WorldEvent = {
      type: 'ENTITY_LEFT',
      entityId,
    };

    return ok([event]);
  }

  /**
   * Submit an action on behalf of an entity.
   * Actions go through the validation -> apply pipeline.
   * Returns events on success.
   */
  submitAction(entityId: string, action: WorldAction): Result<WorldEvent[]> {
    return processAction(this.state, entityId, action);
  }

  /**
   * Set the AI target for an entity.
   * This is used by external AI controllers (like the Python API bridge).
   */
  setEntityTarget(entityId: string, target: { x: number; y: number } | undefined): void {
    const entity = this.state.entities.get(entityId);
    if (entity) {
      const updated = { 
        ...entity, 
        targetPosition: target,
        targetSetAt: target ? Date.now() : undefined,
        positionHistory: target ? [] : entity.positionHistory,
        stuckCounter: target ? 0 : entity.stuckCounter,
        plannedPath: undefined, // Clear old path, will be replanned
        pathPlanTime: undefined
      };
      this.state.entities.set(entityId, updated);
    }
  }

  /**
   * Update entity kind in place (e.g., PLAYER -> ROBOT or vice versa).
   * This avoids the remove/add pattern that causes visual flickering.
   * Returns events for the kind change.
   */
  updateEntityKind(entityId: string, newKind: 'PLAYER' | 'ROBOT'): Result<WorldEvent[]> {
    const entity = this.state.entities.get(entityId);
    if (!entity) {
      return err('ENTITY_NOT_FOUND', `Entity ${entityId} does not exist`);
    }

    if (entity.kind === newKind) {
      return ok([]); // No change needed
    }

    // Update the entity kind and clear AI-specific properties if becoming PLAYER
    const updated = {
      ...entity,
      kind: newKind,
      direction: { x: 0 as const, y: 0 as const },
      targetPosition: undefined,
      plannedPath: undefined
    };

    this.state.entities.set(entityId, updated);

    // Return a state changed event (no ENTITY_LEFT/ENTITY_JOINED)
    return ok([{
      type: 'ENTITY_STATE_CHANGED',
      entityId,
      conversationState: entity.conversationState
    }]);
  }

  /**
   * Teleport an entity to a specific position immediately.
   * Used for respawning players.
   * Returns ENTITY_MOVED event on success.
   */
  moveEntityTo(entityId: string, x: number, y: number): Result<WorldEvent[]> {
    const entity = this.state.entities.get(entityId);
    if (!entity) {
      return err('ENTITY_NOT_FOUND', `Entity ${entityId} does not exist`);
    }

    // Clamp to map bounds
    const clamped = clampToBounds(this.state.map, x, y);

    // Update entity position and clear pathfinding state
    const updated = {
      ...entity,
      x: clamped.x,
      y: clamped.y,
      facing: { x: 0 as const, y: 1 as const }, // Face down after respawn
      targetPosition: undefined,
      plannedPath: undefined,
      positionHistory: [],
      stuckCounter: 0
    };

    this.state.entities.set(entityId, updated);

    return ok([{
      type: 'ENTITY_MOVED',
      entityId,
      x: clamped.x,
      y: clamped.y
    }]);
  }

  /**
   * Advance the world by one tick.
   * Moves entities based on their current direction.
   * Updates AI logic.
   */
  tick(): WorldEvent[] {
    const events: WorldEvent[] = [];
    const entities = getAllEntities(this.state);
    const currentTime = Date.now();
    
    // Build obstacle maps for pathfinding
    const staticObstacles = new Set<string>();
    const dynamicObstacles = new Set<string>();
    
    for (const e of entities) {
      if (e.kind === 'WALL') {
        // Walls are 1x1
        staticObstacles.add(`${e.x},${e.y}`);
      } else {
        // Players and Robots are 1x1
        dynamicObstacles.add(`${e.x},${e.y}`);
      }
    }

    // Create reservation table for this tick
    const reservations = new ReservationTable();
    const moveProposals: MoveProposal[] = [];

    // Phase 1: Plan paths and collect move proposals
    for (const entity of entities) {
      if (entity.kind === 'WALL') continue;

      // Pathfinding for any entity with a target (ROBOT or PLAYER walking to conversation)
      // Players get targetPosition when walking to conversation partner
      if (entity.targetPosition) {
        let target: { x: number; y: number } | undefined = entity.targetPosition;
        let targetSetAt: number | undefined = entity.targetSetAt;
        let positionHistory = entity.positionHistory || [];
        let stuckCounter = entity.stuckCounter || 0;
        let plannedPath = entity.plannedPath;
        let lastMovedTime = entity.lastMovedTime || currentTime;
        
        // Special case: if entity is already at their target position (e.g., conversation target who stays still)
        // They don't need to move, skip the movement logic
        if (entity.x === target.x && entity.y === target.y) {
          // Already at destination - just need to wait for partner (if in WALKING_TO_CONVERSATION)
          // Add a wait proposal so they hold their position
          moveProposals.push({
            entityId: entity.entityId,
            from: { x: entity.x, y: entity.y },
            to: { x: entity.x, y: entity.y },
            priority: 0 // High priority to stay put
          });
          continue;
        }
        
        const currentPos = `${entity.x},${entity.y}`;
        const { NO_PROGRESS_TIMEOUT_MS, REPLAN_INTERVAL, HISTORY_SIZE, STUCK_THRESHOLD } = PATHFINDING_CONFIG;
        
        // Check if robot has made progress recently
        const lastPos = positionHistory.length > 0 ? positionHistory[0] : null;
        const hasMoved = lastPos !== currentPos;
        
        if (hasMoved) {
          // Robot moved - update last moved time
          lastMovedTime = currentTime;
        }
        
        // Check for timeout (entity hasn't moved toward target for too long)
        if (target && lastMovedTime && (currentTime - lastMovedTime > NO_PROGRESS_TIMEOUT_MS)) {
          // Timeout - give up on this target (entity is stuck/blocked)
          // For conversation targets, this means they couldn't reach the partner
          
          // If in WALKING_TO_CONVERSATION state, we need to reset conversation state too
          if (entity.conversationState === 'WALKING_TO_CONVERSATION') {
            console.log(`[World] ${entity.displayName} (${entity.entityId.substring(0, 8)}) timed out walking to conversation - resetting to IDLE`);
            
            // Reset conversation state for this entity
            const currentEntity = this.state.entities.get(entity.entityId)!;
            const resetEntity = {
              ...currentEntity,
              conversationState: 'IDLE' as const,
              conversationTargetId: undefined,
              conversationPartnerId: undefined,
              targetPosition: undefined,
              plannedPath: undefined,
              direction: { x: 0 as const, y: 0 as const },
              positionHistory: [],
              stuckCounter: 0,
              lastMovedTime: currentTime
            };
            this.state.entities.set(entity.entityId, resetEntity);
            
            // Also reset the partner if they were waiting for this entity
            const partnerId = entity.conversationTargetId;
            if (partnerId) {
              const partner = this.state.entities.get(partnerId);
              if (partner && partner.conversationState === 'WALKING_TO_CONVERSATION' && partner.conversationTargetId === entity.entityId) {
                console.log(`[World] Also resetting partner ${partner.displayName} (${partnerId.substring(0, 8)}) to IDLE`);
                const resetPartner = {
                  ...partner,
                  conversationState: 'IDLE' as const,
                  conversationTargetId: undefined,
                  conversationPartnerId: undefined,
                  targetPosition: undefined,
                  plannedPath: undefined,
                  direction: { x: 0 as const, y: 0 as const },
                  positionHistory: [],
                  stuckCounter: 0,
                  lastMovedTime: currentTime
                };
                this.state.entities.set(partnerId, resetPartner);
              }
            }
            
            // Skip further processing for this entity this tick
            continue;
          }
          
          target = undefined;
          targetSetAt = undefined;
          positionHistory = [];
          stuckCounter = 0;
          plannedPath = undefined;
          lastMovedTime = currentTime;
        }
        
        // Update position history
        positionHistory = [currentPos, ...positionHistory].slice(0, HISTORY_SIZE);
        
        // Detect if stuck (same position appears too many times in recent history)
        const positionCounts = positionHistory.reduce((acc, pos) => {
          acc[pos] = (acc[pos] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        const isStuckInLoop = Object.values(positionCounts).some(count => count >= STUCK_THRESHOLD);
        
        // Detect oscillation (alternating between 2 positions)
        let isOscillating = false;
        if (positionHistory.length >= 6) {
          // Check if robot is alternating between two positions (A-B-A-B-A-B pattern)
          const pos0 = positionHistory[0];
          const pos1 = positionHistory[1];
          
          if (pos0 !== pos1) {
            // Check for alternating pattern in last 6 positions
            const alternates = 
              positionHistory[2] === pos0 &&
              positionHistory[3] === pos1 &&
              positionHistory[4] === pos0 &&
              positionHistory[5] === pos1;
            
            if (alternates) {
              isOscillating = true;
            }
          }
        }
        
        if (isStuckInLoop || isOscillating) {
          stuckCounter++;
          // Clear path to force replan
          plannedPath = undefined;
        } else {
          // Reset stuck counter if we're making progress
          stuckCounter = 0;
        }

        // Cached BFS pathfinding with path caching
        if (target) {
          // Check if we need to replan
          const needsReplan = !plannedPath || 
                              plannedPath.length === 0 || 
                              (entity.pathPlanTime && (currentTime - entity.pathPlanTime) > REPLAN_INTERVAL * 100);
          
          if (needsReplan) {
            // Replan path using BFS
            const selfCells = [`${entity.x},${entity.y}`];
            
            // Exclude self and partner from obstacles
            const pathObstacles = new Set(staticObstacles);
            for (const cell of dynamicObstacles) {
              pathObstacles.add(cell);
            }
            
            selfCells.forEach(c => pathObstacles.delete(c));
            
            // Also exclude target cells (for conversation pathfinding, we want to path TO the target)
            // AND exclude the partner themselves so they don't block the path
            if (entity.conversationTargetId) {
              const partner = this.state.entities.get(entity.conversationTargetId);
              if (partner) {
                pathObstacles.delete(`${partner.x},${partner.y}`);
              }
            }
            
            // Also explicitly exclude target area cells
            const targetCells = [`${target.x},${target.y}`];
            targetCells.forEach(c => pathObstacles.delete(c));
            
            plannedPath = findPath(this.state.map, { x: entity.x, y: entity.y }, target, pathObstacles) || undefined;
            
            // Log pathfinding failures for WALKING_TO_CONVERSATION entities
            if (!plannedPath && entity.conversationState === 'WALKING_TO_CONVERSATION') {
              console.log(`[World] No path found for ${entity.displayName} (${entity.entityId.substring(0, 8)}) from (${entity.x}, ${entity.y}) to (${target.x}, ${target.y})`);
            }
          }
          
          if (plannedPath && plannedPath.length > 0) {
            // Check if we've reached the target OR if we're close enough to start facing
            const nextStep = plannedPath[0];
            
            // Check if we are already close enough to the partner to face them (strictly cardinal)
            if (entity.conversationState === 'WALKING_TO_CONVERSATION' && entity.conversationTargetId) {
              const partner = this.state.entities.get(entity.conversationTargetId);
              if (partner && isWithinConversationRange(entity.x, entity.y, partner.x, partner.y)) {
                // We are close enough! Start facing them now (strictly cardinal)
                const dx = partner.x - entity.x;
                const dy = partner.y - entity.y;
                
                let myFx: 0 | 1 | -1 = 0;
                let myFy: 0 | 1 | -1 = 0;
                if (Math.abs(dx) >= Math.abs(dy)) {
                  myFx = (dx > 0 ? 1 : -1) as 1 | -1;
                } else {
                  myFy = (dy > 0 ? 1 : -1) as 1 | -1;
                }
                const myFacingToPartner = { x: myFx, y: myFy };

                let pFx: 0 | 1 | -1 = 0;
                let pFy: 0 | 1 | -1 = 0;
                if (Math.abs(dx) >= Math.abs(dy)) {
                  pFx = (dx > 0 ? -1 : 1) as 1 | -1;
                } else {
                  pFy = (dy > 0 ? -1 : 1) as 1 | -1;
                }
                const partnerFacingToMe = { x: pFx, y: pFy };

                // Update my facing if needed
                if (!entity.facing || entity.facing.x !== myFacingToPartner.x || entity.facing.y !== myFacingToPartner.y) {
                  const currentEntity = this.state.entities.get(entity.entityId)!;
                  this.state.entities.set(entity.entityId, { ...currentEntity, facing: myFacingToPartner });
                  events.push({
                    type: 'ENTITY_TURNED',
                    entityId: entity.entityId,
                    facing: myFacingToPartner
                  });
                }

                // Update partner's facing if needed (so they track us as we arrive)
                if (!partner.facing || partner.facing.x !== partnerFacingToMe.x || partner.facing.y !== partnerFacingToMe.y) {
                  const currentPartner = this.state.entities.get(partner.entityId)!;
                  this.state.entities.set(partner.entityId, { ...currentPartner, facing: partnerFacingToMe });
                  events.push({
                    type: 'ENTITY_TURNED',
                    entityId: partner.entityId,
                    facing: partnerFacingToMe
                  });
                }
              }
            }

            if (nextStep.x === entity.x && nextStep.y === entity.y) {
              // Remove current position from path
              plannedPath = plannedPath.slice(1);
            }
            
            if (plannedPath.length === 0) {
              // At target - clear pathfinding state
              
              // If this is conversation pathfinding, face the conversation partner
              if (entity.conversationState === 'WALKING_TO_CONVERSATION' && entity.conversationTargetId) {
                const conversationPartner = this.state.entities.get(entity.conversationTargetId);
                if (conversationPartner) {
                  // Calculate direction to face partner (strictly cardinal)
                  const dx = conversationPartner.x - entity.x;
                  const dy = conversationPartner.y - entity.y;
                  let fx: 0 | 1 | -1 = 0;
                  let fy: 0 | 1 | -1 = 0;
                  
                  if (Math.abs(dx) >= Math.abs(dy)) {
                    fx = (dx > 0 ? 1 : -1) as 1 | -1;
                  } else {
                    fy = (dy > 0 ? 1 : -1) as 1 | -1;
                  }
                  const facingDirection = { x: fx, y: fy };
                  
                  // Update entity to face the partner
                  const currentEntity = this.state.entities.get(entity.entityId)!;
                  const updatedWithFacing = {
                    ...currentEntity,
                    facing: facingDirection,
                  };
                  this.state.entities.set(entity.entityId, updatedWithFacing);

                  // Emit facing event
                  if (!currentEntity.facing || currentEntity.facing.x !== facingDirection.x || currentEntity.facing.y !== facingDirection.y) {
                    events.push({
                      type: 'ENTITY_TURNED',
                      entityId: entity.entityId,
                      facing: facingDirection
                    });
                  }
                }
                
                // ONLY push a wait proposal if this entity is actually at its target.
                // For the receiver, targetPosition is their current position, so this is always true.
                // For the initiator, this is only true when they've arrived.
                if (entity.x === entity.targetPosition.x && entity.y === entity.targetPosition.y) {
                  moveProposals.push({
                    entityId: entity.entityId,
                    from: { x: entity.x, y: entity.y },
                    to: { x: entity.x, y: entity.y },
                    priority: 0 // High priority to stay put
                  });
                }
              } else {
                target = undefined;
                targetSetAt = undefined;
                positionHistory = [];
                stuckCounter = 0;
                plannedPath = undefined;
                lastMovedTime = currentTime;
              }
            } else {
              // Propose next move from path
              const next = plannedPath[0];
              const dx = next.x - entity.x;
              const dy = next.y - entity.y;
              
              if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
                // Valid next step - create move proposal
                const priority = stuckCounter >= 5 ? 100 : Math.abs(target.x - entity.x) + Math.abs(target.y - entity.y);
                moveProposals.push({
                  entityId: entity.entityId,
                  from: { x: entity.x, y: entity.y },
                  to: next,
                  priority
                });
              } else {
                // Path is invalid, replan next tick
                plannedPath = undefined;
              }
            }
          }
        }
        // Store updated state for this entity (ROBOT or PLAYER with target)
        const currentEntity = this.state.entities.get(entity.entityId)!;
        const updatedEntity = { 
          ...currentEntity, 
          targetPosition: target || undefined, 
          targetSetAt: targetSetAt || undefined,
          positionHistory,
          stuckCounter: Math.min(stuckCounter, 10),
          plannedPath,
          pathPlanTime: currentTime,
          lastMovedTime
        };
        this.state.entities.set(entity.entityId, updatedEntity);
      }
    }

    // Phase 2: Resolve move proposals using reservation table
    const approvedMoves = resolveMoves(moveProposals, reservations, currentTime);

    // Phase 3: Execute approved moves and handle rejections
    for (const entity of entities) {
      if (entity.kind === 'WALL') continue;

      // Set direction for entities with approved pathfinding moves (ROBOT or PLAYER with targetPosition)
      if (entity.kind === 'ROBOT' || entity.targetPosition) {
        const currentEntity = this.state.entities.get(entity.entityId)!;
        let nextDir = { x: 0 as 0|1|-1, y: 0 as 0|1|-1 };
        let useUnstuckMovement = false;
        
        const approvedMove = approvedMoves.get(entity.entityId);
        
        if (approvedMove !== undefined) {
          if (approvedMove === null) {
            // Move was rejected or wait - try unstuck if stuck counter high
            if (currentEntity.stuckCounter && currentEntity.stuckCounter >= 5) {
              useUnstuckMovement = true;
            }
          } else {
            // Move approved - execute it
            const dx = approvedMove.x - entity.x;
            const dy = approvedMove.y - entity.y;
            nextDir = { x: dx as 0|1|-1, y: dy as 0|1|-1 };
          }
        }
        
        // Unstuck algorithm: try random valid movements to escape deadlock
        if (useUnstuckMovement && currentEntity.targetPosition) {
          const positionHistory = currentEntity.positionHistory || [];
          const directions: Array<{ x: 0|1|-1, y: 0|1|-1 }> = [
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 },
          ];
          
          const recentPositions = new Set(positionHistory.slice(0, 3));
          const validDirections = directions.filter(dir => {
            const newX = entity.x + dir.x;
            const newY = entity.y + dir.y;
            const newPos = `${newX},${newY}`;
            
            if (newX < 0 || newY < 0 || newX >= this.state.map.width || newY >= this.state.map.height) {
              return false;
            }
            
            if (recentPositions.has(newPos)) {
              return false;
            }
            
            return true;
          });
          
          if (validDirections.length > 0) {
            const randomDir = validDirections[Math.floor(Math.random() * validDirections.length)];
            nextDir = randomDir;
          } else if (directions.length > 0) {
            const randomDir = directions[Math.floor(Math.random() * directions.length)];
            nextDir = randomDir;
          }
        }

        // Update direction and facing
        const newFacing = (nextDir.x !== 0 || nextDir.y !== 0) ? nextDir : entity.facing;
        const updatedEntity = { 
          ...currentEntity,
          direction: nextDir, 
          facing: newFacing 
        };
        this.state.entities.set(entity.entityId, updatedEntity);

        // If entity turned, emit event
        if (entity.facing && (entity.facing.x !== newFacing!.x || entity.facing.y !== newFacing!.y)) {
          events.push({
            type: 'ENTITY_TURNED',
            entityId: entity.entityId,
            facing: newFacing!
          });
        }
      }

      // Movement Processing (for both Players and Robots)
      const currentEntity = this.state.entities.get(entity.entityId)!;
      
      if (currentEntity.direction && (currentEntity.direction.x !== 0 || currentEntity.direction.y !== 0)) {
        const targetX = currentEntity.x + currentEntity.direction.x;
        const targetY = currentEntity.y + currentEntity.direction.y;
        
        const result = this.submitAction(currentEntity.entityId, {
          type: 'MOVE',
          x: targetX,
          y: targetY
        });

        if (result.ok) {
          events.push(...result.value);
        } else {
          // If blocked, stop.
          // For robot, this will trigger "pick new target" logic next tick implicitly (if we clear target?)
          // But "targetPosition" is still set. The pathfinder will try to find a path around it next tick.
          // Unless the obstacle is the target itself (unlikely for walls).
        }
      }
    }

    // Check for conversation proximity (entities reaching each other)
    const conversationEvents = this.checkConversationProximity();
    events.push(...conversationEvents);
    
    // Cleanup expired conversation requests and sync entity state
    const expiredRequests = this.conversationRequests.cleanupExpired();
    for (const req of expiredRequests) {
      // If the initiator was in PENDING_REQUEST state for this specific request, reset them
      const initiator = this.state.entities.get(req.initiatorId);
      const target = this.state.entities.get(req.targetId);
      if (initiator && initiator.conversationState === 'PENDING_REQUEST' && initiator.pendingConversationRequestId === req.requestId) {
        const updated = {
          ...initiator,
          conversationState: 'IDLE' as const,
          conversationTargetId: undefined,
          pendingConversationRequestId: undefined,
          targetPosition: undefined,
          direction: { x: 0 as const, y: 0 as const }
        };
        this.state.entities.set(req.initiatorId, updated);
        
        // Emit a proper rejection event with auto-decline reason
        events.push({
          type: 'CONVERSATION_REJECTED',
          requestId: req.requestId,
          initiatorId: req.initiatorId,
          targetId: req.targetId,
          cooldownUntil: Date.now() + CONVERSATION_CONFIG.REJECTION_COOLDOWN_MS,
          rejectorName: target?.displayName,
          reason: 'Request timed out - no response within time limit'
        });
        
        events.push({
          type: 'ENTITY_STATE_CHANGED',
          entityId: req.initiatorId,
          conversationState: 'IDLE'
        });
      }
    }

    // Safety cleanup: Reset any entities stuck in WALKING_TO_CONVERSATION without a valid target or partner
    const WALKING_TIMEOUT_MS = 15000; // Max 15 seconds to walk to conversation
    for (const entity of this.state.entities.values()) {
      if (entity.conversationState === 'WALKING_TO_CONVERSATION') {
        const partner = entity.conversationTargetId ? this.state.entities.get(entity.conversationTargetId) : null;
        
        // Check for invalid states:
        // 1. No partner exists anymore
        // 2. Partner is not in WALKING_TO_CONVERSATION or IN_CONVERSATION state (they gave up)
        // 3. Partner's conversationTargetId doesn't point back to us
        const partnerInvalid = !partner || 
          (partner.conversationState !== 'WALKING_TO_CONVERSATION' && partner.conversationState !== 'IN_CONVERSATION') ||
          (partner.conversationTargetId !== entity.entityId && partner.conversationPartnerId !== entity.entityId);
        
        // Check for walking timeout (been walking too long)
        const walkingTooLong = entity.targetSetAt && (currentTime - entity.targetSetAt > WALKING_TIMEOUT_MS);
        
        if (partnerInvalid || walkingTooLong) {
          const reason = partnerInvalid 
            ? `partner state invalid (partner: ${partner?.conversationState || 'missing'})` 
            : 'walking timeout exceeded';
          console.log(`[World] Safety cleanup: ${entity.displayName} (${entity.entityId.substring(0, 8)}) stuck in WALKING_TO_CONVERSATION - ${reason}`);
          
          const resetEntity = {
            ...entity,
            conversationState: 'IDLE' as const,
            conversationTargetId: undefined,
            conversationPartnerId: undefined,
            targetPosition: undefined,
            plannedPath: undefined,
            direction: { x: 0 as const, y: 0 as const },
            positionHistory: [],
            stuckCounter: 0
          };
          this.state.entities.set(entity.entityId, resetEntity);
          
          events.push({
            type: 'ENTITY_STATE_CHANGED',
            entityId: entity.entityId,
            conversationState: 'IDLE'
          });
        }
      }
    }

    return events;
  }

  // ============================================================================
  // CONVERSATION METHODS
  // ============================================================================

  /**
   * Request a conversation with another entity.
   * Returns the conversation request event if successful.
   * @param initiatorId - The entity requesting the conversation
   * @param targetId - The entity being requested
   * @param reason - Optional reason why the initiator wants to talk
   */
  requestConversation(
    initiatorId: string, 
    targetId: string,
    reason?: string
  ): Result<WorldEvent[]> {
    const initiator = this.state.entities.get(initiatorId);
    const target = this.state.entities.get(targetId);
    
    if (!initiator) return err('INITIATOR_NOT_FOUND', 'Initiator entity not found');
    if (!target) return err('TARGET_NOT_FOUND', 'Target entity not found');
    if (target.kind === 'WALL') return err('INVALID_TARGET', 'Cannot converse with walls');
    
    // Check distance
    if (!isWithinInitiationRange(initiator.x, initiator.y, target.x, target.y)) {
      return err('OUT_OF_RANGE', 'Target is too far away to initiate conversation');
    }
    
    // Check if either party is already in a conversation or busy with conversation-related activity
    // This prevents "group chats" by ensuring strict 1-on-1 conversations only
    if (initiator.conversationState && initiator.conversationState !== 'IDLE') {
      return err('ALREADY_IN_CONVERSATION', `Initiator is busy (${initiator.conversationState})`);
    }
    if (target.conversationState && target.conversationState !== 'IDLE') {
      return err('TARGET_BUSY', `Target is busy (${target.conversationState})`);
    }
    
    // Create the request
    const initiatorType = initiator.kind === 'ROBOT' ? 'ROBOT' : 'PLAYER';
    const targetType = target.kind === 'ROBOT' ? 'ROBOT' : 'PLAYER';
    
    const request = this.conversationRequests.createRequest(
      initiatorId, 
      targetId, 
      initiatorType, 
      targetType
    );
    
    if (!request) {
      return err('REQUEST_FAILED', 'Please wait 30 seconds before requesting another conversation.');
    }
    
    // Update initiator state
    const updatedInitiator = {
      ...initiator,
      conversationState: 'PENDING_REQUEST' as const,
      conversationTargetId: targetId,
      pendingConversationRequestId: request.requestId
    };
    this.state.entities.set(initiatorId, updatedInitiator);
    
    const event: WorldEvent = {
      type: 'CONVERSATION_REQUESTED',
      requestId: request.requestId,
      initiatorId,
      targetId,
      initiatorType,
      targetType,
      expiresAt: request.expiresAt,
      initiatorName: initiator.displayName,
      reason: reason
    };
    
    return ok([event]);
  }

  /**
   * Accept a conversation request.
   * @param acceptorId - The entity accepting the request
   * @param requestId - The conversation request ID
   * @param reason - Optional reason why the acceptor is accepting
   */
  acceptConversation(acceptorId: string, requestId: string, reason?: string): Result<WorldEvent[]> {
    const request = this.conversationRequests.getRequest(requestId);
    if (!request) return err('REQUEST_NOT_FOUND', 'Conversation request not found');
    if (request.targetId !== acceptorId) return err('NOT_TARGET', 'Only the target can accept');
    if (request.status !== 'PENDING') return err('REQUEST_NOT_PENDING', 'Request is no longer pending');
    
    const initiator = this.state.entities.get(request.initiatorId);
    const target = this.state.entities.get(request.targetId);
    
    if (!initiator || !target) {
      return err('ENTITY_NOT_FOUND', 'One of the participants no longer exists');
    }
    
    // Verify both entities are still available for this specific conversation
    // Initiator should be in PENDING_REQUEST for THIS request
    if (initiator.conversationState !== 'PENDING_REQUEST' || initiator.pendingConversationRequestId !== requestId) {
      return err('INITIATOR_BUSY', 'Initiator is no longer waiting for this conversation');
    }
    // Target should be IDLE (not already in another conversation flow)
    if (target.conversationState && target.conversationState !== 'IDLE') {
      return err('TARGET_BUSY', 'Target is already busy with another conversation');
    }
    
    const accepted = this.conversationRequests.acceptRequest(requestId);
    if (!accepted) return err('ACCEPT_FAILED', 'Failed to accept request');
    
    // Cancel ALL other pending requests involving either entity to prevent group chats
    // This ensures strict 1-on-1 conversations
    this.conversationRequests.cancelRequestsInvolving(request.initiatorId, requestId);
    this.conversationRequests.cancelRequestsInvolving(request.targetId, requestId);
    
    // Calculate position adjacent to target in the direction they're facing
    // Calculate the closest adjacent position to the initiator
    // Entities are 1x1, so adjacent positions are:
    // - Right: x + 1, y
    // - Left: x - 1, y
    // - Down: x, y + 1
    // - Up: x, y - 1
    
    const possiblePositions = [
      { x: target.x + 1, y: target.y }, // Right
      { x: target.x - 1, y: target.y }, // Left
      { x: target.x, y: target.y + 1 }, // Down
      { x: target.x, y: target.y - 1 }  // Up
    ];
    
    // Filter to only valid positions (in bounds and not blocked by walls/entities)
    const validPositions = possiblePositions.filter(pos => {
      // Check bounds
      if (pos.x < 0 || pos.y < 0 || pos.x >= this.state.map.width || pos.y >= this.state.map.height) {
        return false;
      }
      
      // Check if position is blocked by a wall or another entity
      const posKey = `${pos.x},${pos.y}`;
      for (const entity of this.state.entities.values()) {
        if (entity.entityId === request.initiatorId || entity.entityId === request.targetId) continue;
        if (entity.x === pos.x && entity.y === pos.y) {
          return false;
        }
      }
      
      return true;
    });
    
    // If no valid positions, try using initiator's current position if they're already adjacent
    if (validPositions.length === 0) {
      // Check if initiator is already adjacent to target
      if (areAdjacent(initiator.x, initiator.y, target.x, target.y)) {
        console.log(`[World] No valid adjacent positions, but initiator already adjacent to target`);
        // Use initiator's current position
        validPositions.push({ x: initiator.x, y: initiator.y });
      } else {
        console.log(`[World] No valid adjacent positions available for conversation`);
        return err('NO_VALID_POSITION', 'No valid position adjacent to target');
      }
    }
    
    // Find the closest valid position to the initiator's current location
    let adjacentPosition = validPositions[0];
    let minDistance = getDistance(initiator.x, initiator.y, validPositions[0].x, validPositions[0].y);
    
    for (let i = 1; i < validPositions.length; i++) {
      const pos = validPositions[i];
      const dist = getDistance(initiator.x, initiator.y, pos.x, pos.y);
      if (dist < minDistance) {
        minDistance = dist;
        adjacentPosition = pos;
      }
    }
    
    console.log(`[World] Conversation accepted: ${initiator.displayName} walking to (${adjacentPosition.x}, ${adjacentPosition.y}) to talk to ${target.displayName} at (${target.x}, ${target.y})`)
    
    // Update both entities to WALKING_TO_CONVERSATION state
    // Initiator will walk to position adjacent to target
    const now = Date.now();
    const updatedInitiator = {
      ...initiator,
      conversationState: 'WALKING_TO_CONVERSATION' as const,
      conversationTargetId: request.targetId,
      targetPosition: adjacentPosition, // Walk to adjacent position
      targetSetAt: now, // Track when walking started for timeout detection
      direction: { x: 0 as const, y: 0 as const },
      pendingConversationRequestId: undefined,
      plannedPath: undefined, // Clear any old path
      positionHistory: [], // Reset history
      stuckCounter: 0,
      lastMovedTime: now
    };
    
    // Target should face the initiator immediately (strictly cardinal)
    const dxToInitiator = initiator.x - target.x;
    const dyToInitiator = initiator.y - target.y;
    let fx: 0 | 1 | -1 = 0;
    let fy: 0 | 1 | -1 = 0;
    
    if (Math.abs(dxToInitiator) >= Math.abs(dyToInitiator)) {
      fx = (dxToInitiator > 0 ? 1 : -1) as 1 | -1;
    } else {
      fy = (dyToInitiator > 0 ? 1 : -1) as 1 | -1;
    }
    const targetFacingDir = { x: fx, y: fy };

    const updatedTarget = {
      ...target,
      conversationState: 'WALKING_TO_CONVERSATION' as const,
      conversationTargetId: request.initiatorId,
      targetPosition: { x: target.x, y: target.y }, // Lock them here using the same target system
      targetSetAt: now, // Track when walking started for timeout detection
      direction: { x: 0 as const, y: 0 as const }, // Target stands still
      facing: targetFacingDir
    };
    
    this.state.entities.set(request.initiatorId, updatedInitiator);
    this.state.entities.set(request.targetId, updatedTarget);
    
    const events: WorldEvent[] = [
      {
        type: 'CONVERSATION_ACCEPTED',
        requestId,
        initiatorId: request.initiatorId,
        targetId: request.targetId,
        acceptorName: target.displayName,
        reason: reason
      },
      {
        type: 'ENTITY_STATE_CHANGED',
        entityId: request.initiatorId,
        conversationState: 'WALKING_TO_CONVERSATION',
        conversationTargetId: request.targetId
      },
      {
        type: 'ENTITY_STATE_CHANGED',
        entityId: request.targetId,
        conversationState: 'WALKING_TO_CONVERSATION',
        conversationTargetId: request.initiatorId
      },
      {
        type: 'ENTITY_TURNED',
        entityId: request.targetId,
        facing: targetFacingDir
      }
    ];
    
    return ok(events);
  }

  /**
   * Reject a conversation request.
   * @param rejectorId - The entity rejecting the request
   * @param requestId - The conversation request ID
   * @param reason - Optional reason why the rejector is declining
   */
  rejectConversation(rejectorId: string, requestId: string, reason?: string): Result<WorldEvent[]> {
    const request = this.conversationRequests.getRequest(requestId);
    if (!request) return err('REQUEST_NOT_FOUND', 'Conversation request not found');
    if (request.targetId !== rejectorId) return err('NOT_TARGET', 'Only the target can reject');
    
    const rejected = this.conversationRequests.rejectRequest(requestId);
    if (!rejected) return err('REJECT_FAILED', 'Failed to reject request');
    
    // Reset initiator state and clear any pathfinding
    const initiator = this.state.entities.get(request.initiatorId);
    const rejector = this.state.entities.get(rejectorId);
    if (initiator) {
      const updatedInitiator = {
        ...initiator,
        conversationState: 'IDLE' as const,
        conversationTargetId: undefined,
        pendingConversationRequestId: undefined,
        targetPosition: undefined,
        direction: { x: 0 as const, y: 0 as const }
      };
      this.state.entities.set(request.initiatorId, updatedInitiator);
    }
    
    const cooldownUntil = Date.now() + CONVERSATION_CONFIG.REJECTION_COOLDOWN_MS;
    
    const event: WorldEvent = {
      type: 'CONVERSATION_REJECTED',
      requestId,
      initiatorId: request.initiatorId,
      targetId: request.targetId,
      cooldownUntil,
      rejectorName: rejector?.displayName,
      reason: reason
    };
    
    return ok([
      event,
      {
        type: 'ENTITY_STATE_CHANGED',
        entityId: request.initiatorId,
        conversationState: 'IDLE'
      }
    ]);
  }

  /**
   * End an active conversation.
   * @param entityId - The entity ending the conversation
   * @param endedByName - Optional name of who ended it (for notification)
   * @param reason - Optional reason for ending (if agent-initiated)
   */
  endConversation(entityId: string, endedByName?: string, reason?: string): Result<WorldEvent[]> {
    const entity = this.state.entities.get(entityId);
    if (!entity) return err('ENTITY_NOT_FOUND', 'Entity not found');
    if (entity.conversationState !== 'IN_CONVERSATION') {
      return err('NOT_IN_CONVERSATION', 'Entity is not in a conversation');
    }
    
    const partnerId = entity.conversationPartnerId;
    if (!partnerId) return err('NO_PARTNER', 'No conversation partner found');
    
    // Find and remove the active conversation
    let conversationId: string | null = null;
    for (const [id, conv] of this.activeConversations.entries()) {
      if (conv.participant1Id === entityId || conv.participant2Id === entityId) {
        conversationId = id;
        this.activeConversations.delete(id);
        break;
      }
    }
    
    // Reset both entities and clear any pathfinding
    const partner = this.state.entities.get(partnerId);
    
    const updatedEntity = {
      ...entity,
      conversationState: 'IDLE' as const,
      conversationTargetId: undefined,
      conversationPartnerId: undefined,
      targetPosition: undefined,
      direction: { x: 0 as const, y: 0 as const }
    };
    this.state.entities.set(entityId, updatedEntity);
    
    if (partner) {
      const updatedPartner = {
        ...partner,
        conversationState: 'IDLE' as const,
        conversationTargetId: undefined,
        conversationPartnerId: undefined,
        targetPosition: undefined,
        direction: { x: 0 as const, y: 0 as const }
      };
      this.state.entities.set(partnerId, updatedPartner);
    }
    
    const events: WorldEvent[] = [
      {
        type: 'CONVERSATION_ENDED',
        conversationId: conversationId || 'unknown',
        participant1Id: entityId,
        participant2Id: partnerId,
        endedBy: entityId,
        endedByName: endedByName || entity.displayName,
        reason: reason
      },
      {
        type: 'ENTITY_STATE_CHANGED',
        entityId: entityId,
        conversationState: 'IDLE'
      },
      {
        type: 'ENTITY_STATE_CHANGED',
        entityId: partnerId,
        conversationState: 'IDLE'
      }
    ];

    // Reset facing to down for both
    const defaultFacing = { x: 0 as const, y: 1 as const };
    events.push(
      { type: 'ENTITY_TURNED', entityId: entityId, facing: defaultFacing },
      { type: 'ENTITY_TURNED', entityId: partnerId, facing: defaultFacing }
    );
    
    return ok(events);
  }

  /**
   * Check if two entities are now adjacent and should start their conversation.
   * Called during tick to detect when initiator reaches target.
   */
  private checkConversationProximity(): WorldEvent[] {
    const events: WorldEvent[] = [];
    
    for (const entity of this.state.entities.values()) {
      if (entity.conversationState === 'WALKING_TO_CONVERSATION' && entity.conversationTargetId) {
        const target = this.state.entities.get(entity.conversationTargetId);
        if (!target) continue;
        
        // Check if adjacent
        if (areAdjacent(entity.x, entity.y, target.x, target.y)) {
          // Start the conversation
          const conversationId = `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          this.activeConversations.set(conversationId, {
            participant1Id: entity.entityId,
            participant2Id: target.entityId,
            startedAt: Date.now()
          });
          
          // Calculate facing directions so entities face each other (strictly cardinal)
          const dx = target.x - entity.x;
          const dy = target.y - entity.y;
          
          let efx: 0 | 1 | -1 = 0;
          let efy: 0 | 1 | -1 = 0;
          if (Math.abs(dx) >= Math.abs(dy)) {
            efx = (dx > 0 ? 1 : -1) as 1 | -1;
          } else {
            efy = (dy > 0 ? 1 : -1) as 1 | -1;
          }
          const entityFacing = { x: efx, y: efy };
          
          let tfx: 0 | 1 | -1 = 0;
          let tfy: 0 | 1 | -1 = 0;
          if (Math.abs(dx) >= Math.abs(dy)) {
            tfx = (dx > 0 ? -1 : 1) as 1 | -1;
          } else {
            tfy = (dy > 0 ? -1 : 1) as 1 | -1;
          }
          const targetFacing = { x: tfx, y: tfy };
          
          // Update both entities to IN_CONVERSATION
          const updatedEntity = {
            ...entity,
            conversationState: 'IN_CONVERSATION' as const,
            conversationPartnerId: target.entityId,
            targetPosition: undefined,
            direction: { x: 0 as const, y: 0 as const },
            facing: entityFacing
          };
          
          const updatedTarget = {
            ...target,
            conversationState: 'IN_CONVERSATION' as const,
            conversationPartnerId: entity.entityId,
            direction: { x: 0 as const, y: 0 as const },
            facing: targetFacing
          };
          
          this.state.entities.set(entity.entityId, updatedEntity);
          this.state.entities.set(target.entityId, updatedTarget);
          
          events.push(
            {
              type: 'CONVERSATION_STARTED',
              conversationId,
              participant1Id: entity.entityId,
              participant2Id: target.entityId
            },
            {
              type: 'ENTITY_STATE_CHANGED',
              entityId: entity.entityId,
              conversationState: 'IN_CONVERSATION',
              conversationPartnerId: target.entityId
            },
            {
              type: 'ENTITY_STATE_CHANGED',
              entityId: target.entityId,
              conversationState: 'IN_CONVERSATION',
              conversationPartnerId: entity.entityId
            },
            {
              type: 'ENTITY_TURNED',
              entityId: entity.entityId,
              facing: entityFacing
            },
            {
              type: 'ENTITY_TURNED',
              entityId: target.entityId,
              facing: targetFacing
            }
          );
        }
      }
    }
    
    return events;
  }

  /**
   * Get pending conversation requests for an entity.
   */
  getPendingRequestsFor(entityId: string): ConversationRequest[] {
    return this.conversationRequests.getPendingRequestsFor(entityId);
  }

  /**
   * Check if an entity can initiate conversation with another.
   */
  canInitiateConversation(initiatorId: string, targetId: string): boolean {
    const initiator = this.state.entities.get(initiatorId);
    const target = this.state.entities.get(targetId);
    
    if (!initiator || !target) return false;
    if (target.kind === 'WALL') return false;
    // Both must be IDLE to start a new conversation - prevents group chats
    if (initiator.conversationState && initiator.conversationState !== 'IDLE') return false;
    if (target.conversationState && target.conversationState !== 'IDLE') return false;
    if (this.conversationRequests.isOnCooldown(initiatorId, targetId)) return false;
    
    return isWithinInitiationRange(initiator.x, initiator.y, target.x, target.y);
  }

  /**
   * Get entities within initiation range of a given entity.
   */
  getEntitiesInRange(entityId: string): Entity[] {
    const entity = this.state.entities.get(entityId);
    if (!entity) return [];
    
    const result: Entity[] = [];
    for (const other of this.state.entities.values()) {
      if (other.entityId === entityId) continue;
      if (other.kind === 'WALL') continue;
      if (isWithinInitiationRange(entity.x, entity.y, other.x, other.y)) {
        result.push(other);
      }
    }
    return result;
  }

  /**
   * Set the timestamp when an entity can make its next AI decision.
   */
  setEntityNextDecision(entityId: string, timestamp: number): void {
    const entity = this.state.entities.get(entityId);
    if (entity) {
      const updated = { ...entity, nextDecisionAt: timestamp };
      this.state.entities.set(entityId, updated);
    }
  }

  /**
   * Get a snapshot of the current world state.
   * This is a read-only view suitable for serialization.
   */
  getSnapshot(): WorldSnapshot {
    return {
      map: this.state.map,
      entities: getAllEntities(this.state),
    };
  }

  /**
   * Get a specific entity by ID.
   * Returns undefined if not found.
   */
  getEntity(entityId: string): Entity | undefined {
    return this.state.entities.get(entityId);
  }
}
