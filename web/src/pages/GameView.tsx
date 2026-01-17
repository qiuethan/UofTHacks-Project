import { useEffect, useState, useCallback, useRef } from 'react'
import { Grid, Cell, EntityDot, ConnectionStatus } from '../components'
import { useAuth } from '../contexts/AuthContext'

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

const WS_URL = 'ws://localhost:3001'

export default function GameView() {
  const { user, session } = useAuth()
  const [connected, setConnected] = useState(false)
  const [myEntityId, setMyEntityId] = useState<string | null>(null)
  const [mapSize, setMapSize] = useState({ width: 20, height: 15 })
  const [entities, setEntities] = useState<Map<string, Entity>>(new Map())
  const [error, setError] = useState<string | null>(null)
  
  const wsRef = useRef<WebSocket | null>(null)
  const connectingRef = useRef(false)
  const mountedRef = useRef(false)
  const joinedRef = useRef(false)
  const shouldReconnectRef = useRef(true)

  // Input tracking
  const pressedKeysRef = useRef<string[]>([])
  const lastSentDirection = useRef({ x: 0, y: 0 })

  const handleEvent = useCallback((event: WorldEvent) => {
    setEntities(prev => {
      const next = new Map(prev)
      switch (event.type) {
        case 'ENTITY_JOINED':
          if (event.entity) {
            next.set(event.entity.entityId, event.entity)
          }
          break
        case 'ENTITY_LEFT':
          if (event.entityId) {
            next.delete(event.entityId)
          }
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
      return next
    })
  }, [])

  const connect = useCallback(() => {
    // Prevent double connections from StrictMode
    if (connectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }
    if (!session?.access_token) {
      return
    }
    connectingRef.current = true
    setError(null)

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      connectingRef.current = false
      setConnected(true)
      // Send JOIN with auth token and user info
      ws.send(JSON.stringify({ 
        type: 'JOIN', 
        token: session.access_token,
        userId: user?.id,
        displayName: user?.email?.split('@')[0] || 'Player'
      }))
    }

    ws.onclose = () => {
      connectingRef.current = false
      setConnected(false)
      setMyEntityId(null)
      setEntities(new Map())
      // Only reconnect if we had successfully joined before and should reconnect
      if (mountedRef.current && joinedRef.current && shouldReconnectRef.current) {
        joinedRef.current = false
        setTimeout(connect, 2000)
      }
    }

    ws.onerror = () => {
      connectingRef.current = false
      ws.close()
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      
      switch (msg.type) {
        case 'WELCOME':
          setMyEntityId(msg.entityId)
          joinedRef.current = true
          break
          
        case 'SNAPSHOT': {
          const snapshot: WorldSnapshot = msg.snapshot
          setMapSize({ width: snapshot.map.width, height: snapshot.map.height })
          const newEntities = new Map<string, Entity>()
          snapshot.entities.forEach(e => newEntities.set(e.entityId, e))
          setEntities(newEntities)
          break
        }
        
        case 'EVENTS':
          for (const worldEvent of msg.events as WorldEvent[]) {
            handleEvent(worldEvent)
          }
          break

        case 'ERROR':
          setError(msg.error || 'Connection error')
          // Don't reconnect if already connected elsewhere
          if (msg.error === 'ALREADY_CONNECTED') {
            shouldReconnectRef.current = false
          }
          break
      }
    }
  }, [handleEvent, session, user])

  useEffect(() => {
    mountedRef.current = true
    shouldReconnectRef.current = true
    joinedRef.current = false
    // Only connect if we have a valid session
    if (session?.access_token) {
      connect()
    }
    return () => {
      mountedRef.current = false
      shouldReconnectRef.current = false
      joinedRef.current = false
      connectingRef.current = false
      
      // Properly close WebSocket
      const ws = wsRef.current
      if (ws) {
        ws.onclose = null  // Prevent reconnect logic from firing
        ws.onerror = null
        ws.onmessage = null
        ws.onopen = null
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Component unmounted')
        }
        wsRef.current = null
      }
    }
  }, [connect, session])

  const updateDirection = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    let dx = 0
    let dy = 0

    // Use the last key in the stack that is still pressed
    if (pressedKeysRef.current.length > 0) {
      const lastKey = pressedKeysRef.current[pressedKeysRef.current.length - 1]
      
      switch (lastKey) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          dy = -1
          break
        case 'ArrowDown':
        case 's':
        case 'S':
          dy = 1
          break
        case 'ArrowLeft':
        case 'a':
        case 'A':
          dx = -1
          break
        case 'ArrowRight':
        case 'd':
        case 'D':
          dx = 1
          break
      }
    }

    // Only send if changed
    if (dx !== lastSentDirection.current.x || dy !== lastSentDirection.current.y) {
      lastSentDirection.current = { x: dx, y: dy }
      console.log('Client sending SET_DIRECTION:', JSON.stringify({ dx, dy })); // NEW LOG
      ws.send(JSON.stringify({
        type: 'SET_DIRECTION',
        dx,
        dy
      }))
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      console.log('KeyDown:', e.key, 'Stack before:', JSON.stringify([...pressedKeysRef.current])); // NEW LOG
      // Avoid duplicates
      if (!pressedKeysRef.current.includes(e.key)) {
        pressedKeysRef.current.push(e.key)
        updateDirection()
      }
      console.log('Stack after KeyDown:', JSON.stringify([...pressedKeysRef.current])); // NEW LOG
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      console.log('KeyUp:', e.key, 'Stack before:', JSON.stringify([...pressedKeysRef.current])); // NEW LOG
      // Remove from stack
      const index = pressedKeysRef.current.indexOf(e.key)
      if (index > -1) {
        pressedKeysRef.current.splice(index, 1)
        updateDirection()
      }
      console.log('Stack after KeyUp:', JSON.stringify([...pressedKeysRef.current])); // NEW LOG
    }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [updateDirection])

  // Build grid cells using components
  const cells = []
  for (let y = 0; y < mapSize.height; y++) {
    for (let x = 0; x < mapSize.width; x++) {
      const entityHere = Array.from(entities.values()).find(e => e.x === x && e.y === y)
      const isMe = entityHere?.entityId === myEntityId
      
      cells.push(
        <Cell key={`${x}-${y}`}>
          {entityHere && <EntityDot isPlayer={isMe} color={entityHere.color} facing={entityHere.facing} />}
        </Cell>
      )
    }
  }

  return (
    <div className="flex flex-col items-center p-8">
      <h1 className="text-2xl font-bold mb-4 text-gray-400">World Simulation</h1>
      
      <ConnectionStatus connected={connected} />
      
      {error && (
        <div className="mb-4 px-4 py-2 rounded text-sm bg-red-900 text-red-400">
          {error}
        </div>
      )}
      
      <Grid width={mapSize.width} height={mapSize.height}>
        {cells}
      </Grid>
      
      <p className="mt-4 text-gray-500 text-sm">
        Use arrow keys or WASD to move (Server Tick Rate: 10Hz)
      </p>
    </div>
  )
}
