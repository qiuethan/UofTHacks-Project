import { useEffect, useState, useRef, useCallback } from 'react'
import { ConnectionStatus, GameLoading } from '../components'
import AgentSidebar from '../components/AgentSidebar'
import { PhaserGame } from '../game'
import { WS_CONFIG, MAP_DEFAULTS, API_CONFIG } from '../config'
import type { GameEntity, WorldLocation } from '../game/types'
import type { SpriteUrls, ChatMessage } from '../types/game'
import { Plus, Minus, RotateCcw } from 'lucide-react'

interface Entity {
  entityId: string
  kind: 'PLAYER' | 'WALL' | 'ROBOT'
  displayName: string
  x: number
  y: number
  color?: string
  facing?: { x: number; y: number }
  sprites?: SpriteUrls
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
  conversationState?: string
  conversationPartnerId?: string
  conversationTargetId?: string
}

interface WorldSnapshot {
  map: { width: number; height: number }
  entities: Entity[]
}

interface WorldEvent {
  type: 'ENTITY_JOINED' | 'ENTITY_LEFT' | 'ENTITY_MOVED' | 'ENTITY_TURNED' | 'ENTITY_STATS_UPDATED' | 
        'ENTITY_STATE_CHANGED' | 'CONVERSATION_STARTED' | 'CONVERSATION_ENDED'
  entityId?: string
  entity?: Entity
  x?: number
  y?: number
  facing?: { x: number; y: number }
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
  // Conversation fields
  conversationState?: string
  conversationTargetId?: string
  conversationPartnerId?: string
  participant1Id?: string
  participant2Id?: string
  conversationId?: string
}


export default function WatchView() {
  const [connected, setConnected] = useState(false)
  const [mapSize, setMapSize] = useState({ width: MAP_DEFAULTS.WIDTH, height: MAP_DEFAULTS.HEIGHT })
  const [entities, setEntities] = useState<Map<string, Entity>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number | undefined>(undefined)
  const [pan, setPan] = useState<{ x: number; y: number } | undefined>(undefined)
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  
  // Track chat messages for all entities (for speech bubbles)
  const [allEntityMessages, setAllEntityMessages] = useState<Map<string, ChatMessage>>(new Map())
  
  // World locations state
  const [worldLocations, setWorldLocations] = useState<WorldLocation[]>([])
  
  const wsRef = useRef<WebSocket | null>(null)
  const connectingRef = useRef(false)
  const mountedRef = useRef(false)
  const shouldReconnectRef = useRef(true)

  const connect = useCallback(() => {
    if (connectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }
    connectingRef.current = true
    setError(null)

    const ws = new WebSocket(WS_CONFIG.WATCH_URL)
    wsRef.current = ws

    ws.onopen = () => {
      connectingRef.current = false
      setConnected(true)
    }

    ws.onclose = () => {
      connectingRef.current = false
      setConnected(false)
      setEntities(new Map())
      
      if (mountedRef.current && shouldReconnectRef.current) {
        setTimeout(connect, WS_CONFIG.RECONNECT_DELAY_MS)
      }
    }

    ws.onerror = () => {
      connectingRef.current = false
      ws.close()
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        
        switch (msg.type) {
          case 'SNAPSHOT': {
            const snapshot: WorldSnapshot = msg.snapshot
            setMapSize({ width: snapshot.map.width, height: snapshot.map.height })
            const newEntities = new Map<string, Entity>()
            snapshot.entities.forEach(e => newEntities.set(e.entityId, e))
            setEntities(newEntities)
            
            // Debug: Log entity sprite data
            console.log('[Watch] Received SNAPSHOT with entities:')
            snapshot.entities.forEach(e => {
              if (e.kind !== 'WALL') {
                console.log(`  - ${e.displayName} (${e.kind}):`, {
                  hasSprites: !!e.sprites,
                  inConversation: e.conversationState === 'IN_CONVERSATION',
                  partnerId: e.conversationPartnerId
                })
              }
            })
            break
          }
          
          case 'EVENTS':
            setEntities(prev => {
              const next = new Map(prev)
              for (const worldEvent of msg.events as WorldEvent[]) {
                switch (worldEvent.type) {
                  case 'ENTITY_JOINED':
                    if (worldEvent.entity) next.set(worldEvent.entity.entityId, worldEvent.entity)
                    break
                  case 'ENTITY_LEFT':
                    if (worldEvent.entityId) next.delete(worldEvent.entityId)
                    break
                  case 'ENTITY_MOVED':
                    if (worldEvent.entityId) {
                      const entity = next.get(worldEvent.entityId)
                      if (entity && worldEvent.x !== undefined && worldEvent.y !== undefined) {
                        next.set(worldEvent.entityId, { 
                          ...entity, 
                          x: worldEvent.x, 
                          y: worldEvent.y,
                          facing: worldEvent.facing || entity.facing
                        })
                      }
                    }
                    break
                  case 'ENTITY_TURNED':
                    if (worldEvent.entityId && worldEvent.facing) {
                      const entity = next.get(worldEvent.entityId)
                      if (entity) {
                        next.set(worldEvent.entityId, { ...entity, facing: worldEvent.facing })
                      }
                    }
                    break
                  case 'ENTITY_STATS_UPDATED':
                    if (worldEvent.entityId && worldEvent.stats) {
                      const entity = next.get(worldEvent.entityId)
                      if (entity) {
                        next.set(worldEvent.entityId, { ...entity, stats: worldEvent.stats })
                      }
                    }
                    break
                  case 'ENTITY_STATE_CHANGED':
                    if (worldEvent.entityId) {
                      const entity = next.get(worldEvent.entityId)
                      if (entity) {
                        next.set(worldEvent.entityId, { 
                          ...entity, 
                          conversationState: worldEvent.conversationState || entity.conversationState,
                          conversationTargetId: worldEvent.conversationTargetId,
                          conversationPartnerId: worldEvent.conversationPartnerId
                        })
                      }
                    }
                    break
                  case 'CONVERSATION_STARTED':
                    // Update both participants to be in conversation
                    if (worldEvent.participant1Id && worldEvent.participant2Id) {
                      const p1 = next.get(worldEvent.participant1Id)
                      const p2 = next.get(worldEvent.participant2Id)
                      if (p1) {
                        next.set(worldEvent.participant1Id, {
                          ...p1,
                          conversationState: 'IN_CONVERSATION',
                          conversationPartnerId: worldEvent.participant2Id
                        })
                      }
                      if (p2) {
                        next.set(worldEvent.participant2Id, {
                          ...p2,
                          conversationState: 'IN_CONVERSATION',
                          conversationPartnerId: worldEvent.participant1Id
                        })
                      }
                    }
                    break
                  case 'CONVERSATION_ENDED':
                    // Clear conversation state for both participants
                    if (worldEvent.participant1Id && worldEvent.participant2Id) {
                      const p1 = next.get(worldEvent.participant1Id)
                      const p2 = next.get(worldEvent.participant2Id)
                      if (p1) {
                        next.set(worldEvent.participant1Id, {
                          ...p1,
                          conversationState: 'IDLE',
                          conversationPartnerId: undefined
                        })
                      }
                      if (p2) {
                        next.set(worldEvent.participant2Id, {
                          ...p2,
                          conversationState: 'IDLE',
                          conversationPartnerId: undefined
                        })
                      }
                    }
                    break
                }
              }
              return next
            })
            break

          case 'CHAT_MESSAGE':
            // Handle chat messages for speech bubbles
            console.log(`[Watch] RAW CHAT_MESSAGE received:`, msg)
            if (msg.messageId && msg.senderId && msg.content) {
              const chatMessage: ChatMessage = {
                id: msg.messageId,
                senderId: msg.senderId,
                senderName: msg.senderName || 'Unknown',
                content: msg.content,
                timestamp: msg.timestamp || Date.now(),
                conversationId: msg.conversationId
              }
              
              console.log(`[Watch] Chat processed: ${chatMessage.senderName} (${chatMessage.senderId.substring(0, 8)}): ${chatMessage.content.substring(0, 50)}...`)
              
              // Track for entity chat bubbles
              setAllEntityMessages(prev => {
                const next = new Map(prev)
                next.set(msg.senderId, chatMessage)
                return next
              })
              
              // Auto-clear the entity message after 8 seconds (longer for watch mode)
              setTimeout(() => {
                setAllEntityMessages(prev => {
                  const next = new Map(prev)
                  const current = next.get(msg.senderId)
                  // Only delete if it's still the same message
                  if (current?.id === msg.messageId) {
                    next.delete(msg.senderId)
                  }
                  return next
                })
              }, 8000)
            }
            break

          case 'ERROR':
            setError(msg.error || 'Connection error')
            break
        }
      } catch (e) {
        console.error(e)
      }
    }
  }, [])

  // Fetch world locations on mount
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/world/locations`)
        const data = await response.json()
        if (data.ok && data.data) {
          setWorldLocations(data.data)
          console.log('[WatchView] Loaded world locations:', data.data.length)
        }
      } catch (err) {
        console.error('[WatchView] Failed to fetch world locations:', err)
      }
    }
    fetchLocations()
  }, [])

  useEffect(() => {
    mountedRef.current = true
    shouldReconnectRef.current = true
    
    connect()
    
    return () => {
      mountedRef.current = false
      shouldReconnectRef.current = false
      connectingRef.current = false
      
      const ws = wsRef.current
      if (ws) {
        ws.onclose = null
        ws.onerror = null
        ws.onmessage = null
        ws.onopen = null
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Component unmounted')
        }
        wsRef.current = null
      }
    }
  }, [connect])

  // Convert entities to GameEntity format for Phaser
  const gameEntities = new Map<string, GameEntity>()
  for (const [id, entity] of entities) {
    gameEntities.set(id, {
      entityId: entity.entityId,
      kind: entity.kind,
      displayName: entity.displayName,
      x: entity.x,
      y: entity.y,
      color: entity.color,
      facing: entity.facing,
      sprites: entity.sprites,
      conversationState: entity.conversationState,
      conversationPartnerId: entity.conversationPartnerId,
      stats: entity.stats
    })
  }

  // Zoom controls - pan only works via drag when zoomed in
  // Default zoom (undefined) means fit-to-screen, which Phaser calculates
  // Zoom multiplier: 1.0 = default, >1 = zoomed in, <1 would zoom out (but we prevent that)
  const handleZoomIn = () => {
    setZoom(prev => {
      const currentZoom = prev || 1.0 // 1.0 means default/baseline
      return Math.min(currentZoom * 1.3, 4) // Max zoom 4x the default
    })
  }

  const handleZoomOut = () => {
    setZoom(prev => {
      if (!prev || prev <= 1.0) return undefined // Return to default
      return prev / 1.3
    })
  }

  const handleResetView = () => {
    setZoom(undefined)
    setPan(undefined)
  }

  return (
    <div className="w-full h-[calc(100vh-64px)] overflow-hidden relative">
      {/* Loading Screen */}
      {isLoading && <GameLoading onComplete={() => setIsLoading(false)} minDuration={2000} />}

      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 text-sm bg-[#FFF8F0] text-black border-2 border-black shadow-[4px_4px_0_#000]">
          {error}
        </div>
      )}
      
      <div className="hidden">
        <ConnectionStatus connected={connected} />
      </div>
      
      {/* Zoom Controls */}
      <div className="absolute top-4 right-[30px] z-50">
        <div className="panel-fun p-2 flex flex-col gap-1">
          <button
            onClick={handleZoomIn}
            className="bg-[#007a28] hover:bg-[#009830] text-white px-3 py-2 transition-colors border-radius-[4px] flex items-center justify-center"
            title="Zoom In (scroll wheel also works)"
          >
            <Plus size={20} />
          </button>
          <button
            onClick={handleZoomOut}
            className="bg-[#007a28] hover:bg-[#009830] text-white px-3 py-2 transition-colors border-radius-[4px] flex items-center justify-center"
            title="Zoom Out (scroll wheel also works)"
          >
            <Minus size={20} />
          </button>
          <button
            onClick={handleResetView}
            className="bg-[#007a28] hover:bg-[#009830] text-white px-3 py-2 transition-colors border-radius-[4px] flex items-center justify-center"
            title="Reset View"
          >
            <RotateCcw size={20} />
          </button>
        </div>
        <div className="text-black text-xs mt-2 text-center">
          Drag to pan<br/>when zoomed
        </div>
      </div>

      {/* Agent Monitoring Sidebar */}
      <AgentSidebar 
        isOpen={sidebarOpen} 
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        entities={gameEntities}
      />
      
      {/* Phaser Game Canvas - Watch mode (no input) */}
      <PhaserGame
        entities={gameEntities}
        mapSize={mapSize}
        mode="watch"
        inputEnabled={false}
        watchZoom={zoom}
        watchPan={pan}
        allEntityMessages={allEntityMessages}
        worldLocations={worldLocations}
      />
    </div>
  )
}
