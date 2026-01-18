export type EntityType = 'PLAYER' | 'WALL' | 'ROBOT';

export interface SpriteUrls {
  readonly front?: string;
  readonly back?: string;
  readonly left?: string;
  readonly right?: string;
}

export interface Entity {
  readonly entityId: string;
  readonly kind: EntityType;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly color?: string;
  // Sprite URLs for each direction
  readonly sprites?: SpriteUrls;
  // Movement intent (for tick-based movement)
  readonly direction?: { x: 0 | 1 | -1; y: 0 | 1 | -1 };
  // Orientation (where the entity is looking)
  readonly facing?: { x: 0 | 1 | -1; y: 0 | 1 | -1 };
  // AI Goal
  readonly targetPosition?: { x: number; y: number };
  // Stuck detection (for robots)
  readonly targetSetAt?: number; // Timestamp when target was set
  readonly positionHistory?: string[]; // Last N positions as "x,y" strings
  readonly stuckCounter?: number; // How many ticks we've been stuck
  // WHCA* planned path (for cooperative pathfinding)
  readonly plannedPath?: Array<{ x: number; y: number }>; // Space-time path from WHCA*
  readonly pathPlanTime?: number; // When the path was last planned
  readonly lastMovedTime?: number; // Last time robot successfully moved (for progress timeout)
  // AI Decisions
  readonly nextDecisionAt?: number; // Timestamp when robot can make next decision
  // Conversation state
  readonly conversationState?: 'IDLE' | 'PENDING_REQUEST' | 'WALKING_TO_CONVERSATION' | 'IN_CONVERSATION';
  readonly conversationTargetId?: string; // Entity we're trying to talk to or talking with
  readonly pendingConversationRequestId?: string; // Request ID if we have a pending request
  readonly conversationPartnerId?: string; // ID of entity we're currently in conversation with
  // Agent stats (from agent_state table)
  readonly stats?: {
    energy?: number;
    hunger?: number;
    loneliness?: number;
    mood?: number;
  };
}

export function createEntity(
  entityId: string,
  kind: EntityType,
  displayName: string,
  x: number,
  y: number,
  color?: string,
  initialFacing?: { x: 0 | 1 | -1; y: 0 | 1 | -1 }
): Entity {
  return {
    entityId,
    kind,
    displayName,
    x: Math.floor(x),
    y: Math.floor(y),
    color,
    direction: { x: 0, y: 0 }, // Default no movement
    facing: initialFacing || { x: 0, y: 1 } // Default facing down, or use initialFacing
  };
}
