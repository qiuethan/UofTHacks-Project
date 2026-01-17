import { useEffect, useState, useRef, useCallback } from 'react'
import { Grid, Cell, EntityDot, ConnectionStatus } from '../components'

interface Entity {
  entityId: string
  kind: 'PLAYER' | 'WALL' | 'ROBOT'
  displayName: string
  x: number
  y: number
  color?: string
  facing?: { x: number; y: number }
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

const WS_URL = 'ws://localhost:3002'

export default function WatchView() {
  const [connected, setConnected] = useState(false)
  const [mapSize, setMapSize] = useState({ width: 20, height: 15 })
  const [entities, setEntities] = useState<Map<string, Entity>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [debugLog, setDebugLog] = useState<string[]>([])
  
  const wsRef = useRef<WebSocket | null>(null)
  const connectingRef = useRef(false)
  const mountedRef = useRef(false)
  const shouldReconnectRef = useRef(true)

  const addLog = useCallback((msg: string) => {
    setDebugLog(prev => [msg, ...prev].slice(0, 5))
  }, [])

  const connect = useCallback(() => {
    if (connectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }
    connectingRef.current = true
    setError(null)
    addLog('Connecting...')

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      connectingRef.current = false
      setConnected(true)
      addLog('Connected')
    }

    ws.onclose = () => {
      connectingRef.current = false
      setConnected(false)
      setEntities(new Map())
      addLog('Disconnected')
      
      if (mountedRef.current && shouldReconnectRef.current) {
        setTimeout(connect, 2000)
      }
    }

    ws.onerror = () => {
      connectingRef.current = false
      ws.close()
      addLog('Connection Error')
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
            addLog(`Snapshot: ${snapshot.entities.length} entities`)
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
            addLog(`Error: ${msg.error}`)
            break
        }
      } catch (e) {
        console.error(e)
        addLog('Error parsing message')
      }
    }
  }, [addLog])

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

  // Build grid cells
  const cells = []
  for (let y = 0; y < mapSize.height; y++) {
    for (let x = 0; x < mapSize.width; x++) {
      const entityHere = Array.from(entities.values()).find(e => e.x === x && e.y === y)
      
      cells.push(
        <Cell key={`${x}-${y}`}>
          {entityHere && <EntityDot color={entityHere.color} facing={entityHere.facing} />}
        </Cell>
      )
    }
  }

  return (
    <div className="flex flex-col items-center p-8">
      <h1 className="text-2xl font-bold mb-4 text-gray-400">World Simulation - Spectator Mode</h1>
      
      <div className="flex gap-4 items-center mb-4">
        <ConnectionStatus connected={connected} />
        <span className="text-gray-500 text-sm">
          {entities.size} entities | Map: {mapSize.width}x{mapSize.height}
        </span>
      </div>
      
      {error && (
        <div className="mb-4 px-4 py-2 rounded text-sm bg-red-900 text-red-400">
          {error}
        </div>
      )}
      
      <Grid width={mapSize.width} height={mapSize.height}>
        {cells}
      </Grid>
      
      <div className="mt-8 w-full max-w-md">
        <h3 className="text-gray-500 text-xs uppercase font-bold mb-2">Debug Log</h3>
        <div className="bg-gray-900 p-2 rounded text-xs font-mono text-gray-400 h-24 overflow-y-auto">
          {debugLog.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
          {debugLog.length === 0 && <span className="opacity-50">No logs yet...</span>}
        </div>
      </div>
    </div>
  )
}
