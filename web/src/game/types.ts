import type { SpriteUrls, ChatMessage, WorldLocation, PlayerActivityState } from '../types/game'

export interface GameEntity {
  entityId: string
  kind: 'PLAYER' | 'WALL' | 'ROBOT'
  displayName: string
  x: number
  y: number
  color?: string
  facing?: { x: number; y: number }
  sprites?: SpriteUrls
  conversationState?: string
  conversationPartnerId?: string
  stats?: {
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
}

export type { WorldLocation, PlayerActivityState }

export interface GameProps {
  entities: Map<string, GameEntity>
  mapSize: { width: number; height: number }
  myEntityId?: string | null
  mode: 'play' | 'watch'
  onDirectionChange?: (dx: -1 | 0 | 1, dy: -1 | 0 | 1) => void
  onRequestConversation?: (targetEntityId: string) => void
  inputEnabled?: boolean
  inConversationWith?: string | null
  chatMessages?: ChatMessage[]
  allEntityMessages?: Map<string, ChatMessage>
  watchZoom?: number
  watchPan?: { x: number; y: number }
  followEntityId?: string | null
  // World locations
  worldLocations?: WorldLocation[]
  // Player activity state
  playerActivityState?: PlayerActivityState
  currentLocationId?: string | null
}

export interface SceneData {
  entities: Map<string, GameEntity>
  mapSize: { width: number; height: number }
  myEntityId?: string | null
  mode: 'play' | 'watch'
  onDirectionChange?: (dx: -1 | 0 | 1, dy: -1 | 0 | 1) => void
  onRequestConversation?: (targetEntityId: string) => void
  inputEnabled?: boolean
  inConversationWith?: string | null
  chatMessages?: ChatMessage[]
  allEntityMessages?: Map<string, ChatMessage>
  watchZoom?: number
  watchPan?: { x: number; y: number }
  followEntityId?: string | null
  // World locations
  worldLocations?: WorldLocation[]
  // Player activity state
  playerActivityState?: PlayerActivityState
  currentLocationId?: string | null
}
