import { useEffect, useState, useCallback, useRef } from 'react'
import type { Entity, WorldEvent, WorldSnapshot, ConversationRequest } from '../types/game'
import { WS_CONFIG, MAP_DEFAULTS } from '../config'

interface UseGameSocketOptions {
  token: string | undefined
  userId: string | undefined
  displayName: string | undefined
}

interface GameSocketState {
  connected: boolean
  myEntityId: string | null
  mapSize: { width: number; height: number }
  entities: Map<string, Entity>
  error: string | null
  pendingRequests: ConversationRequest[]
  inConversationWith: string | null
  isWalkingToConversation: boolean
  cooldowns: Map<string, number>
  notification: string | null
}

interface GameSocketActions {
  sendDirection: (dx: -1 | 0 | 1, dy: -1 | 0 | 1) => void
  requestConversation: (targetEntityId: string) => void
  acceptConversation: (requestId: string) => void
  rejectConversation: (requestId: string) => void
  endConversation: () => void
  clearNotification: () => void
}

/**
 * Hook for managing WebSocket connection to the game server.
 * Handles authentication, reconnection, and event processing.
 */
export function useGameSocket({ token, userId, displayName }: UseGameSocketOptions): [GameSocketState, GameSocketActions] {
  const [connected, setConnected] = useState(false)
  const [myEntityId, setMyEntityId] = useState<string | null>(null)
  const [mapSize, setMapSize] = useState({ width: MAP_DEFAULTS.WIDTH, height: MAP_DEFAULTS.HEIGHT })
  const [entities, setEntities] = useState<Map<string, Entity>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [pendingRequests, setPendingRequests] = useState<ConversationRequest[]>([])
  const [inConversationWith, setInConversationWith] = useState<string | null>(null)
  const [isWalkingToConversation, setIsWalkingToConversation] = useState(false)
  const [cooldowns, setCooldowns] = useState<Map<string, number>>(new Map())
  const [notification, setNotification] = useState<string | null>(null)
  
  // Sync conversation state from entities map
  useEffect(() => {
    if (myEntityId) {
      const me = entities.get(myEntityId)
      if (me?.conversationState === 'IN_CONVERSATION' && me.conversationPartnerId) {
        setInConversationWith(me.conversationPartnerId)
      } else {
        setInConversationWith(null)
      }

      if (me?.conversationState === 'WALKING_TO_CONVERSATION') {
        setIsWalkingToConversation(true)
      } else {
        setIsWalkingToConversation(false)
      }
    }
  }, [entities, myEntityId])

  // Cleanup expired cooldowns
  useEffect(() => {
    const timer = setInterval(() => {
      setCooldowns(current => {
        const now = Date.now()
        let hasExpired = false
        const next = new Map(current)
        for (const [key, expiry] of next.entries()) {
          if (now >= expiry) {
            next.delete(key)
            hasExpired = true
          }
        }
        return hasExpired ? next : current
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])  
  const wsRef = useRef<WebSocket | null>(null)
  const connectingRef = useRef(false)
  const mountedRef = useRef(false)
  const joinedRef = useRef(false)
  const shouldReconnectRef = useRef(true)

  // Handle world events (entity updates)
  const handleEvent = useCallback((event: WorldEvent) => {
    setEntities(prev => {
      const next = new Map(prev)
      switch (event.type) {
        case 'ENTITY_JOINED':
          if (event.entity) {
            next.set(event.entity.entityId, event.entity)
          }
          break;
        case 'ENTITY_LEFT':
          if (event.entityId) {
            next.delete(event.entityId)
          }
          break
        case 'ENTITY_MOVED':
          if (event.entityId && event.x !== undefined && event.y !== undefined) {
            const entity = next.get(event.entityId)
            if (entity) {
              next.set(event.entityId, { ...entity, x: event.x, y: event.y })
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
        case 'ENTITY_STATE_CHANGED':
          if (event.entityId) {
            const entity = next.get(event.entityId)
            if (entity) {
              next.set(event.entityId, { 
                ...entity, 
                conversationState: event.conversationState,
                conversationTargetId: event.conversationTargetId,
                conversationPartnerId: event.conversationPartnerId
              })
            }
          }
          break
      }
      return next
    })
  }, [])

  // Handle conversation events
  const handleConversationEvent = useCallback((event: WorldEvent) => {
    switch (event.type) {
      case 'CONVERSATION_REQUESTED':
        // If we're the target, show the request
        if (event.targetId === myEntityId && event.requestId && event.initiatorId) {
          setEntities(currentEntities => {
            const initiator = currentEntities.get(event.initiatorId!)
            setPendingRequests(prev => [...prev, {
              requestId: event.requestId!,
              initiatorId: event.initiatorId!,
              initiatorName: initiator?.displayName || 'Someone',
              expiresAt: event.expiresAt || Date.now() + 30000
            }])
            return currentEntities
          })
        }
        break
      case 'CONVERSATION_ACCEPTED':
        // Clear pending requests when accepted
        setPendingRequests([])
        break
      case 'CONVERSATION_STARTED':
        // No manual sync needed, useEffect handles it from entity state
        break
      case 'CONVERSATION_REJECTED':
        // Remove from pending requests
        setPendingRequests(prev => prev.filter(r => r.requestId !== event.requestId))
        
        // Update cooldowns
        if (event.initiatorId && event.targetId && event.cooldownUntil) {
          setCooldowns(prev => {
            const next = new Map(prev)
            next.set(`${event.initiatorId}:${event.targetId}`, event.cooldownUntil!)
            return next
          })
        }

        // Show notification if we were part of this
        if (event.initiatorId === myEntityId) {
          setEntities(current => {
            const target = current.get(event.targetId!)
            setNotification(`Conversation request to ${target?.displayName || 'target'} was rejected.`)
            return current
          })
          setTimeout(() => setNotification(null), 5000)
        } else if (event.targetId === myEntityId) {
          setNotification('You rejected the conversation request.')
          setTimeout(() => setNotification(null), 5000)
        }
        break
      case 'CONVERSATION_ENDED':
        // No manual sync needed, useEffect handles it from entity state
        break
    }
  }, [myEntityId])
  
  // Store latest callbacks in refs for stable reference in WebSocket handlers
  const handleEventRef = useRef(handleEvent)
  const handleConversationEventRef = useRef(handleConversationEvent)
  
  useEffect(() => {
    handleEventRef.current = handleEvent
  }, [handleEvent])
  
  useEffect(() => {
    handleConversationEventRef.current = handleConversationEvent
  }, [handleConversationEvent])

  const connect = useCallback(() => {
    console.log('[useGameSocket] connect() called, token:', !!token, 'connecting:', connectingRef.current, 'wsState:', wsRef.current?.readyState)
    if (connectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[useGameSocket] Already connecting or connected, skipping')
      return
    }
    if (!token) {
      console.log('[useGameSocket] No token, cannot connect')
      return
    }
    connectingRef.current = true

    console.log('[useGameSocket] Creating WebSocket to:', WS_CONFIG.PLAY_URL)
    const ws = new WebSocket(WS_CONFIG.PLAY_URL)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[useGameSocket] WebSocket opened, sending JOIN')
      connectingRef.current = false
      ws.send(JSON.stringify({
        type: 'JOIN',
        token,
        userId,
        displayName: displayName || 'Anonymous'
      }))
    }

    ws.onclose = (event) => {
      console.log('[useGameSocket] WebSocket closed:', event.code, event.reason)
      connectingRef.current = false
      setConnected(false)
      setEntities(new Map())
      
      if (mountedRef.current && joinedRef.current && shouldReconnectRef.current) {
        joinedRef.current = false
        console.log('[useGameSocket] Will reconnect in', WS_CONFIG.RECONNECT_DELAY_MS, 'ms')
        setTimeout(connect, WS_CONFIG.RECONNECT_DELAY_MS)
      }
    }

    ws.onerror = (error) => {
      console.error('[useGameSocket] WebSocket error:', error)
      connectingRef.current = false
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      console.log('[useGameSocket] Received message:', msg.type)
      
      switch (msg.type) {
        case 'WELCOME':
          console.log('[useGameSocket] WELCOME received, entityId:', msg.entityId)
          setMyEntityId(msg.entityId)
          setConnected(true)
          joinedRef.current = true
          setError(null)
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
            handleEventRef.current(worldEvent)
            handleConversationEventRef.current(worldEvent)
          }
          break

        case 'ERROR':
          setError(msg.error || 'Connection error')
          if (msg.error === 'ALREADY_CONNECTED') {
            shouldReconnectRef.current = false
          }
          break
      }
    }
  }, [token, userId, displayName])

  useEffect(() => {
    console.log('[useGameSocket] useEffect triggered, token:', !!token, 'wsRef:', !!wsRef.current)
    mountedRef.current = true
    shouldReconnectRef.current = true
    joinedRef.current = false
    
    if (token && !wsRef.current) {
      console.log('[useGameSocket] Calling connect()')
      connect()
    } else {
      console.log('[useGameSocket] NOT connecting - token:', !!token, 'wsRef:', !!wsRef.current)
    }

    return () => {
      console.log('[useGameSocket] Cleanup')
      mountedRef.current = false
      shouldReconnectRef.current = false
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect, token])

  // Action methods
  const sendDirection = useCallback((dx: -1 | 0 | 1, dy: -1 | 0 | 1) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'SET_DIRECTION', dx, dy }))
  }, [])

  const requestConversation = useCallback((targetEntityId: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'REQUEST_CONVERSATION', targetEntityId }))
  }, [])

  const acceptConversation = useCallback((requestId: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'ACCEPT_CONVERSATION', requestId }))
  }, [])

  const rejectConversation = useCallback((requestId: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'REJECT_CONVERSATION', requestId }))
  }, [])

  const endConversation = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'END_CONVERSATION' }))
  }, [])

  const clearNotification = useCallback(() => {
    setNotification(null)
  }, [])

  const state: GameSocketState = {
    connected,
    myEntityId,
    mapSize,
    entities,
    error,
    pendingRequests,
    inConversationWith,
    isWalkingToConversation,
    cooldowns,
    notification
  }

  const actions: GameSocketActions = {
    sendDirection,
    requestConversation,
    acceptConversation,
    rejectConversation,
    endConversation,
    clearNotification
  }

  return [state, actions]
}
