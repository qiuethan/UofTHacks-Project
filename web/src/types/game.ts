// Game-related types for the frontend

export interface SpriteUrls {
  front?: string
  back?: string
  left?: string
  right?: string
}

// World Location types
export type LocationType = 'food' | 'karaoke' | 'rest_area' | 'social_hub' | 'wander_point'

export interface WorldLocation {
  id: string
  name: string
  location_type: LocationType
  x: number
  y: number
  description?: string
  effects?: Record<string, number>  // e.g., { hunger: -0.4, mood: 0.1 }
  cooldown_seconds: number
  duration_seconds: number
}

// Player activity state at locations
export type PlayerActivityState = 'idle' | 'walking' | 'talking' | 'eating' | 'resting' | 'socializing' | 'singing' | 'wandering'

export interface EntityStats {
  energy?: number
  hunger?: number
  loneliness?: number
  mood?: number
  current_action?: string
  current_action_target?: {
    target_type?: string
    target_id?: string
    name?: string
    x?: number
    y?: number
  }
}

export interface Entity {
  entityId: string
  kind: 'PLAYER' | 'WALL' | 'ROBOT'
  displayName: string
  x: number
  y: number
  color?: string
  facing?: { x: number; y: number }
  sprites?: SpriteUrls
  conversationState?: ConversationState
  conversationTargetId?: string
  conversationPartnerId?: string
  stats?: EntityStats
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
  | 'ENTITY_STATS_UPDATED'
  | 'CHAT_MESSAGE'

export interface WorldEvent {
  type: WorldEventType
  entityId?: string
  entity?: Entity
  x?: number
  y?: number
  facing?: { x: number; y: number }
  sprites?: SpriteUrls
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
  // Conversation request/accept/reject fields
  initiatorName?: string  // Name of who initiated the request
  acceptorName?: string   // Name of who accepted
  rejectorName?: string   // Name of who rejected
  reason?: string         // Reason for the action
  // Conversation end fields
  endedBy?: string
  endedByName?: string
  // Stats update fields
  stats?: {
    energy?: number
    hunger?: number
    loneliness?: number
    mood?: number
  }
}

export interface ConversationRequest {
  requestId: string
  initiatorId: string
  initiatorName: string
  expiresAt: number
  reason?: string  // Why the initiator wants to chat
}

export interface Direction {
  x: -1 | 0 | 1
  y: -1 | 0 | 1
}

export interface ChatMessage {
  id: string
  senderId: string
  senderName: string
  content: string
  timestamp: number
  conversationId?: string
}
