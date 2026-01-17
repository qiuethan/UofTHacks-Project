// Game-related types for the frontend

export interface Entity {
  entityId: string
  kind: 'PLAYER' | 'WALL' | 'ROBOT'
  displayName: string
  x: number
  y: number
  color?: string
  facing?: { x: number; y: number }
  conversationState?: ConversationState
  conversationTargetId?: string
  conversationPartnerId?: string
}

export type ConversationState = 'IDLE' | 'PENDING_REQUEST' | 'WALKING_TO_CONVERSATION' | 'IN_CONVERSATION'

export interface WorldSnapshot {
  map: { width: number; height: number }
  entities: Entity[]
}

export type WorldEventType = 
  | 'ENTITY_JOINED' 
  | 'ENTITY_LEFT' 
  | 'ENTITY_MOVED' 
  | 'ENTITY_TURNED' 
  | 'CONVERSATION_REQUESTED' 
  | 'CONVERSATION_ACCEPTED' 
  | 'CONVERSATION_REJECTED' 
  | 'CONVERSATION_STARTED' 
  | 'CONVERSATION_ENDED' 
  | 'ENTITY_STATE_CHANGED'

export interface WorldEvent {
  type: WorldEventType
  entityId?: string
  entity?: Entity
  x?: number
  y?: number
  facing?: { x: number; y: number }
  // Conversation fields
  requestId?: string
  initiatorId?: string
  targetId?: string
  expiresAt?: number
  cooldownUntil?: number
  participant1Id?: string
  participant2Id?: string
  conversationState?: ConversationState
  conversationTargetId?: string
  conversationPartnerId?: string
}

export interface ConversationRequest {
  requestId: string
  initiatorId: string
  initiatorName: string
  expiresAt: number
}

export interface Direction {
  x: -1 | 0 | 1
  y: -1 | 0 | 1
}
