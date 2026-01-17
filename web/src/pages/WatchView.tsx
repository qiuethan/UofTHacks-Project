import { useEffect, useState, useRef, useCallback } from 'react'
import { ConnectionStatus } from '../components'
import { PhaserGame } from '../game'
import { WS_CONFIG, MAP_DEFAULTS } from '../config'
import type { GameEntity } from '../game/types'
import type { SpriteUrls } from '../types/game'

interface Entity {
  entityId: string
  kind: 'PLAYER' | 'WALL' | 'ROBOT'
  displayName: string
  x: number
  y: number
  color?: string
  facing?: { x: number; y: number }
  sprites?: SpriteUrls
}

interface WorldSnapshot {
  map: { width: number; height: number }
  entities: Entity[]
}

interface WorldEvent {
  type: 'ENTITY_JOINED' | 'ENTITY_LEFT' | 'ENTITY_MOVED' | 'ENTITY_TURNED'
  entityId?: string
  entity?: Entity
  x?: number
  y?: number
  facing?: { x: number; y: number }
}


export default function WatchView() {
  const [connected, setConnected] = useState(false)
  const [mapSize, setMapSize] = useState({ width: MAP_DEFAULTS.WIDTH, height: MAP_DEFAULTS.HEIGHT })
  const [entities, setEntities] = useState<Map<string, Entity>>(new Map())
  const [error, setError] = useState<string | null>(null)
  
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
                  frontSprite: e.sprites?.front ? e.sprites.front.substring(0, 60) + '...' : 'none'
                })
              }
            })
            break
          }
          
          case 'EVENTS':
            setEntities(prev => {
              const next = new Map(prev)
              for (const event of msg.events as WorldEvent[]) {
                switch (event.type) {
                  case 'ENTITY_JOINED':
                    if (event.entity) next.set(event.entity.entityId, event.entity)
                    break
                  case 'ENTITY_LEFT':
                    if (event.entityId) next.delete(event.entityId)
                    break
                  case 'ENTITY_MOVED':
                    if (event.entityId) {
                      const entity = next.get(event.entityId)
                      if (entity && event.x !== undefined && event.y !== undefined) {
                        next.set(event.entityId, { 
                          ...entity, 
                          x: event.x, 
                          y: event.y,
                          facing: event.facing || entity.facing
                        })
                      }
                    }
                    break
                  case 'ENTITY_TURNED':
                    if (event.entityId && event.facing) {
                      const entity = next.get(event.entityId)
                      if (entity) {
                        next.set(event.entityId, { ...entity, facing: event.facing })
                      }
                    }
                    break
                }
              }
              return next
            })
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
      sprites: entity.sprites
    })
  }

  return (
    <div className="w-full h-[calc(100vh-64px)] overflow-hidden">
      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded text-sm bg-red-900 text-red-400">
          {error}
        </div>
      )}
      
      <div className="hidden">
        <ConnectionStatus connected={connected} />
      </div>
      
      {/* Phaser Game Canvas - Watch mode (no input) */}
      <PhaserGame
        entities={gameEntities}
        mapSize={mapSize}
        mode="watch"
        inputEnabled={false}
      />
    </div>
  )
}
