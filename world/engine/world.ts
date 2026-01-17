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
  areAdjacent,
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
   * Advance the world by one tick.
   * Moves entities based on their current direction.
   * Updates AI logic.
   */
  tick(): WorldEvent[] {
    const events: WorldEvent[] = [];
    const entities = getAllEntities(this.state);
    const currentTime = Date.now();
    
    // Build obstacle map for pathfinding
    const obstacles = new Set<string>();
    for (const e of entities) {
      obstacles.add(`${e.x},${e.y}`);
      obstacles.add(`${e.x + 1},${e.y}`);
      obstacles.add(`${e.x},${e.y + 1}`);
      obstacles.add(`${e.x + 1},${e.y + 1}`);
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
            const selfCells = [
              `${entity.x},${entity.y}`,
              `${entity.x + 1},${entity.y}`,
              `${entity.x},${entity.y + 1}`,
              `${entity.x + 1},${entity.y + 1}`
            ];
            // Also exclude target cells (for conversation pathfinding, we want to path TO the target)
            const targetCells = [
              `${target.x},${target.y}`,
              `${target.x + 1},${target.y}`,
              `${target.x},${target.y + 1}`,
              `${target.x + 1},${target.y + 1}`
            ];
            const pathObstacles = new Set(obstacles);
            selfCells.forEach(c => pathObstacles.delete(c));
            targetCells.forEach(c => pathObstacles.delete(c));
            
            plannedPath = findPath(this.state.map, { x: entity.x, y: entity.y }, target, pathObstacles) || undefined;
          }
          
          if (plannedPath && plannedPath.length > 0) {
            // Check if we've reached the target
            const nextStep = plannedPath[0];
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
                  // Calculate direction to face partner
                  const dx = conversationPartner.x - entity.x;
                  const dy = conversationPartner.y - entity.y;
                  const facingDirection = {
                    x: (dx > 0 ? 1 : dx < 0 ? -1 : 0) as 0 | 1 | -1,
                    y: (dy > 0 ? 1 : dy < 0 ? -1 : 0) as 0 | 1 | -1
                  };
                  
                  // Update entity to face the partner
                  const currentEntity = this.state.entities.get(entity.entityId)!;
                  const updatedWithFacing = {
                    ...currentEntity,
                    facing: facingDirection,
                    targetPosition: undefined,
                    targetSetAt: undefined
                  };
                  this.state.entities.set(entity.entityId, updatedWithFacing);
                }
              }
              
              target = undefined;
              targetSetAt = undefined;
              positionHistory = [];
              stuckCounter = 0;
              plannedPath = undefined;
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
    
    // Cleanup expired conversation requests
    this.conversationRequests.cleanupExpired();

    return events;
  }

  // ============================================================================
  // CONVERSATION METHODS
  // ============================================================================

  /**
   * Request a conversation with another entity.
   * Returns the conversation request event if successful.
   */
  requestConversation(
    initiatorId: string, 
    targetId: string
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
    
    // Check if either party is already in a conversation
    if (initiator.conversationState === 'IN_CONVERSATION') {
      return err('ALREADY_IN_CONVERSATION', 'Initiator is already in a conversation');
    }
    if (target.conversationState === 'IN_CONVERSATION') {
      return err('TARGET_BUSY', 'Target is already in a conversation');
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
      return err('REQUEST_FAILED', 'Could not create request (on cooldown or already pending)');
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
      expiresAt: request.expiresAt
    };
    
    return ok([event]);
  }

  /**
   * Accept a conversation request.
   */
  acceptConversation(acceptorId: string, requestId: string): Result<WorldEvent[]> {
    const request = this.conversationRequests.getRequest(requestId);
    if (!request) return err('REQUEST_NOT_FOUND', 'Conversation request not found');
    if (request.targetId !== acceptorId) return err('NOT_TARGET', 'Only the target can accept');
    if (request.status !== 'PENDING') return err('REQUEST_NOT_PENDING', 'Request is no longer pending');
    
    const accepted = this.conversationRequests.acceptRequest(requestId);
    if (!accepted) return err('ACCEPT_FAILED', 'Failed to accept request');
    
    const initiator = this.state.entities.get(request.initiatorId);
    const target = this.state.entities.get(request.targetId);
    
    if (!initiator || !target) {
      return err('ENTITY_NOT_FOUND', 'One of the participants no longer exists');
    }
    
    // Calculate position adjacent to target in the direction they're facing
    // Initiator should stand IN FRONT of the target (in the direction they're facing)
    // Entities are 2x2, so we need to offset by 2 cells to be adjacent
    // If target is facing down (0, 1), initiator should go below them (0, 2)
    // If target is facing up (0, -1), initiator should go above them (0, -2)
    // If target is facing right (1, 0), initiator should go to their right (2, 0)
    // If target is facing left (-1, 0), initiator should go to their left (-2, 0)
    const targetFacing = target.facing || { x: 0, y: 1 }; // Default facing down
    const adjacentOffset = {
      x: targetFacing.x * 2, // Same direction as facing, 2 cells for 2x2 entity
      y: targetFacing.y * 2
    };
    
    const adjacentPosition = {
      x: target.x + adjacentOffset.x,
      y: target.y + adjacentOffset.y
    };
    
    // Update both entities to WALKING_TO_CONVERSATION state
    // Initiator will walk to position adjacent to target
    const updatedInitiator = {
      ...initiator,
      conversationState: 'WALKING_TO_CONVERSATION' as const,
      conversationTargetId: request.targetId,
      targetPosition: adjacentPosition, // Walk to adjacent position
      pendingConversationRequestId: undefined
    };
    
    const updatedTarget = {
      ...target,
      conversationState: 'WALKING_TO_CONVERSATION' as const,
      conversationTargetId: request.initiatorId,
      direction: { x: 0 as const, y: 0 as const } // Target stands still
    };
    
    this.state.entities.set(request.initiatorId, updatedInitiator);
    this.state.entities.set(request.targetId, updatedTarget);
    
    const events: WorldEvent[] = [
      {
        type: 'CONVERSATION_ACCEPTED',
        requestId,
        initiatorId: request.initiatorId,
        targetId: request.targetId
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
      }
    ];
    
    return ok(events);
  }

  /**
   * Reject a conversation request.
   */
  rejectConversation(rejectorId: string, requestId: string): Result<WorldEvent[]> {
    const request = this.conversationRequests.getRequest(requestId);
    if (!request) return err('REQUEST_NOT_FOUND', 'Conversation request not found');
    if (request.targetId !== rejectorId) return err('NOT_TARGET', 'Only the target can reject');
    
    const rejected = this.conversationRequests.rejectRequest(requestId);
    if (!rejected) return err('REJECT_FAILED', 'Failed to reject request');
    
    // Reset initiator state
    const initiator = this.state.entities.get(request.initiatorId);
    if (initiator) {
      const updatedInitiator = {
        ...initiator,
        conversationState: 'IDLE' as const,
        conversationTargetId: undefined,
        pendingConversationRequestId: undefined
      };
      this.state.entities.set(request.initiatorId, updatedInitiator);
    }
    
    const cooldownUntil = Date.now() + CONVERSATION_CONFIG.REJECTION_COOLDOWN_MS;
    
    const event: WorldEvent = {
      type: 'CONVERSATION_REJECTED',
      requestId,
      initiatorId: request.initiatorId,
      targetId: request.targetId,
      cooldownUntil
    };
    
    return ok([event]);
  }

  /**
   * End an active conversation.
   */
  endConversation(entityId: string): Result<WorldEvent[]> {
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
    
    // Reset both entities
    const partner = this.state.entities.get(partnerId);
    
    const updatedEntity = {
      ...entity,
      conversationState: 'IDLE' as const,
      conversationTargetId: undefined,
      conversationPartnerId: undefined
    };
    this.state.entities.set(entityId, updatedEntity);
    
    if (partner) {
      const updatedPartner = {
        ...partner,
        conversationState: 'IDLE' as const,
        conversationTargetId: undefined,
        conversationPartnerId: undefined
      };
      this.state.entities.set(partnerId, updatedPartner);
    }
    
    const events: WorldEvent[] = [
      {
        type: 'CONVERSATION_ENDED',
        conversationId: conversationId || 'unknown',
        participant1Id: entityId,
        participant2Id: partnerId
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
          
          // Calculate facing directions so entities face each other
          const dx = target.x - entity.x;
          const dy = target.y - entity.y;
          
          // Normalize to -1, 0, or 1
          const entityFacing = {
            x: (dx > 0 ? 1 : dx < 0 ? -1 : 0) as 0 | 1 | -1,
            y: (dy > 0 ? 1 : dy < 0 ? -1 : 0) as 0 | 1 | -1
          };
          
          const targetFacing = {
            x: (dx > 0 ? -1 : dx < 0 ? 1 : 0) as 0 | 1 | -1,
            y: (dy > 0 ? -1 : dy < 0 ? 1 : 0) as 0 | 1 | -1
          };
          
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
    if (initiator.conversationState === 'IN_CONVERSATION') return false;
    if (target.conversationState === 'IN_CONVERSATION') return false;
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
