import { useEffect, useState, useRef, useCallback } from 'react'
import { Grid, Cell, EntityDot, ConnectionStatus, CELL_SIZE, GAP_SIZE } from '../components'
import { WS_CONFIG, MAP_DEFAULTS } from '../config'
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

  // Build empty grid cells
  const cells = []
  for (let y = 0; y < mapSize.height; y++) {
    for (let x = 0; x < mapSize.width; x++) {
      cells.push(<Cell key={`${x}-${y}`} />)
    }
  }

  // Render entities separately with stable keys to prevent blinking
  const entityLayer = (
    <div className="relative" style={{ width: mapSize.width * (CELL_SIZE + GAP_SIZE), height: mapSize.height * (CELL_SIZE + GAP_SIZE) }}>
      {Array.from(entities.values()).map(entity => {
        // Calculate pixel position: each cell is CELL_SIZE + GAP_SIZE wide
        const cellStep = CELL_SIZE + GAP_SIZE
        const left = entity.x * cellStep
        const top = entity.y * cellStep
        
        return (
          <div
            key={entity.entityId}
            className="absolute"
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${CELL_SIZE}px`,
              height: `${CELL_SIZE}px`,
              transition: 'left 100ms ease-out, top 100ms ease-out'
            }}
          >
            <EntityDot 
              color={entity.color} 
              facing={entity.facing}
              sprites={entity.sprites}
              displayName={entity.displayName}
              y={entity.y}
              kind={entity.kind}
            />
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="flex flex-col items-center p-4">
      {error && (
        <div className="mb-4 px-4 py-2 rounded text-sm bg-red-900 text-red-400">
          {error}
        </div>
      )}
      
      <div className="hidden">
        <ConnectionStatus connected={connected} />
      </div>
      
      <Grid width={mapSize.width} height={mapSize.height} entityLayer={entityLayer}>
        {cells}
      </Grid>
    </div>
  )
}
