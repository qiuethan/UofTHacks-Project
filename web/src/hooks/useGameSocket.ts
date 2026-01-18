import { useEffect, useState, useCallback, useRef } from 'react'
import type { Entity, WorldEvent, WorldSnapshot, ConversationRequest, ChatMessage } from '../types/game'
import { WS_CONFIG, MAP_DEFAULTS, API_CONFIG } from '../config'

// Helper to format time since last interaction
function formatTimeSince(lastInteraction: string | null): string | null {
  if (!lastInteraction) return null
  
  const lastDate = new Date(lastInteraction)
  const now = new Date()
  const diffMs = now.getTime() - lastDate.getTime()
  
  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)
  const months = Math.floor(days / 30)
  
  if (months > 0) {
    return months === 1 ? '1 month' : `${months} months`
  }
  if (weeks > 0) {
    return weeks === 1 ? '1 week' : `${weeks} weeks`
  }
  if (days > 0) {
    return days === 1 ? '1 day' : `${days} days`
  }
  if (hours > 0) {
    return hours === 1 ? '1 hour' : `${hours} hours`
  }
  if (minutes > 0) {
    return minutes === 1 ? '1 minute' : `${minutes} minutes`
  }
  return null // Don't show "just now" - too recent
}

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
  chatMessages: ChatMessage[]
  isWaitingForResponse: boolean
  // All entity messages for displaying chat bubbles globally
  allEntityMessages: Map<string, ChatMessage>
}

interface GameSocketActions {
  sendDirection: (dx: -1 | 0 | 1, dy: -1 | 0 | 1) => void
  requestConversation: (targetEntityId: string) => void
  acceptConversation: (requestId: string) => void
  rejectConversation: (requestId: string) => void
  endConversation: () => void
  clearNotification: () => void
  sendChatMessage: (content: string) => void
  respawn: () => void
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
  const inConversationWithRef = useRef<string | null>(null)
  const [isWalkingToConversation, setIsWalkingToConversation] = useState(false)
  
  // Keep ref in sync with state
  useEffect(() => {
    inConversationWithRef.current = inConversationWith
  }, [inConversationWith])
  const [cooldowns, setCooldowns] = useState<Map<string, number>>(new Map())
  const [notification, setNotification] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false)
  const [allEntityMessages, setAllEntityMessages] = useState<Map<string, ChatMessage>>(new Map())
  
  // Sync conversation state from entities map
  useEffect(() => {
    if (myEntityId) {
      const me = entities.get(myEntityId)
      console.log('[ConvSync] myEntityId:', myEntityId?.substring(0, 8), 'convState:', me?.conversationState, 'partner:', me?.conversationPartnerId?.substring(0, 8))
      if (me?.conversationState === 'IN_CONVERSATION' && me.conversationPartnerId) {
        setInConversationWith(prev => {
          console.log('[ConvSync] IN_CONVERSATION - prev:', prev?.substring(0, 8) || 'null', 'new partner:', me.conversationPartnerId?.substring(0, 8))
          // Only clear messages when switching to a DIFFERENT partner in a NEW conversation
          // Don't clear if prev is null/undefined (taking over an agent already in conversation)
          // The server will send conversation history for takeover scenarios
          if (prev !== null && prev !== undefined && prev !== me.conversationPartnerId) {
            console.log('[ConvSync] Clearing messages - switching partners')
            setChatMessages([])
          }
          
          // If we're entering a conversation (prev was null), fetch history from database
          if (prev === null || prev === undefined) {
            console.log('[ConvSync] Taking over conversation, fetching history from database...')
            fetch(`${API_CONFIG.BASE_URL}/conversation/active/${myEntityId}`)
              .then(res => res.json())
              .then(data => {
                console.log('[ConvSync] Got conversation history from DB:', data)
                if (data.ok && data.messages && data.messages.length > 0) {
                  console.log(`[ConvSync] Loading ${data.messages.length} messages from database`)
                  setChatMessages(prevMsgs => {
                    // Merge database messages with any that may have arrived via WebSocket
                    // Use message IDs to prevent duplicates
                    const existingIds = new Set(prevMsgs.map(m => m.id))
                    const newMsgs = data.messages.filter((m: ChatMessage) => !existingIds.has(m.id))
                    // Sort by timestamp
                    const combined = [...prevMsgs, ...newMsgs].sort((a, b) => a.timestamp - b.timestamp)
                    console.log(`[ConvSync] Merged: ${prevMsgs.length} existing + ${newMsgs.length} new = ${combined.length} total`)
                    return combined
                  })
                }
              })
              .catch(err => console.error('[ConvSync] Error fetching conversation history:', err))
          }
          
          return me.conversationPartnerId!
        })
      } else {
        // Clear messages when conversation ends
        if (inConversationWith !== null) {
          console.log('[ConvSync] Clearing messages - conversation ended')
          setChatMessages([])
        }
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
        case 'ENTITY_STATS_UPDATED':
          // Update agent stats (energy, hunger, loneliness, mood)
          if (event.entityId && event.stats) {
            const entity = next.get(event.entityId)
            if (entity) {
              next.set(event.entityId, { 
                ...entity, 
                stats: event.stats
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
        // If we're the target, show the request with reason
        if (event.targetId === myEntityId && event.requestId && event.initiatorId) {
          setEntities(currentEntities => {
            const initiator = currentEntities.get(event.initiatorId!)
            const initiatorName = event.initiatorName || initiator?.displayName || 'Someone'
            setPendingRequests(prev => [...prev, {
              requestId: event.requestId!,
              initiatorId: event.initiatorId!,
              initiatorName: initiatorName,
              expiresAt: event.expiresAt || Date.now() + 30000,
              reason: event.reason
            }])
            // Show notification with reason if provided
            if (event.reason) {
              setNotification(`${initiatorName}: "${event.reason}"`)
              setTimeout(() => setNotification(null), 5000)
            }
            return currentEntities
          })
        }
        break
      case 'CONVERSATION_ACCEPTED':
        // Clear pending requests when accepted
        setPendingRequests([])
        // Show notification if we initiated and someone accepted
        if (event.initiatorId === myEntityId && event.acceptorName) {
          if (event.reason) {
            setNotification(`${event.acceptorName} accepted: "${event.reason}"`)
          } else {
            setNotification(`${event.acceptorName} accepted your request!`)
          }
          setTimeout(() => setNotification(null), 4000)
        }
        break
      case 'CONVERSATION_STARTED':
        // Show welcome back notification if this is us
        // Delay by 4.5 seconds to let the "accepted" notification finish first
        if ((event.participant1Id === myEntityId || event.participant2Id === myEntityId) && myEntityId) {
          const partnerId = event.participant1Id === myEntityId ? event.participant2Id : event.participant1Id
          if (partnerId) {
            // Delay to not conflict with "accepted" notification
            setTimeout(() => {
              // Fetch relationship data to get last_interaction
              fetch(`${API_CONFIG.BASE_URL}/relationship/${myEntityId}/${partnerId}`)
                .then(res => res.json())
                .then(data => {
                  if (data.ok) {
                    setEntities(current => {
                      const partner = current.get(partnerId)
                      const partnerName = partner?.displayName || 'them'
                      
                      if (data.is_new) {
                        setNotification(`👋 First time meeting ${partnerName}! Say hello!`)
                        setTimeout(() => setNotification(null), 5000)
                      } else if (data.last_interaction) {
                        const timeSince = formatTimeSince(data.last_interaction)
                        if (timeSince) {
                          setNotification(`👋 Welcome back! It's been ${timeSince} since you last chatted with ${partnerName}.`)
                          setTimeout(() => setNotification(null), 6000)
                        }
                      }
                      return current
                    })
                  }
                })
                .catch(err => console.error('Error fetching relationship for welcome:', err))
            }, 4500) // Wait for accept notification to clear (4s + 0.5s buffer)
          }
        }
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

        // Show notification if we were part of this - include reason
        if (event.initiatorId === myEntityId) {
          setEntities(current => {
            const target = current.get(event.targetId!)
            const targetName = event.rejectorName || target?.displayName || 'They'
            if (event.reason) {
              setNotification(`${targetName} declined: "${event.reason}"`)
            } else {
              setNotification(`${targetName} declined your conversation request.`)
            }
            return current
          })
          setTimeout(() => setNotification(null), 6000)
        } else if (event.targetId === myEntityId) {
          setEntities(current => {
            const initiator = current.get(event.initiatorId!)
            setNotification(`You declined ${initiator?.displayName || 'their'}'s request.`)
            return current
          })
          setTimeout(() => setNotification(null), 4000)
        }
        break
      case 'CONVERSATION_ENDED':
        // Show notification if the OTHER person ended the conversation
        // We can determine this by checking if we're still in a conversation state
        if (inConversationWith) {
          // Get the partner's name from entities
          setEntities(current => {
            const partner = current.get(inConversationWith)
            // Check if we were a participant
            const wasParticipant = event.participant1Id === myEntityId || event.participant2Id === myEntityId
            
            if (wasParticipant && (partner || event.endedByName)) {
              const enderName = event.endedByName || partner?.displayName || 'Partner'
              // Include reason if provided (agent-initiated end)
              if (event.reason) {
                setNotification(`${enderName} ended the conversation: "${event.reason}"`)
              } else {
                setNotification(`${enderName} ended the conversation.`)
              }
              setTimeout(() => setNotification(null), 6000)
            }
            return current
          })
        }
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

        case 'CHAT_MESSAGE':
          // Handle incoming chat message
          console.log('[CHAT_MESSAGE] Received:', msg.messageId, msg.senderName, msg.content?.substring(0, 30), 'convId:', msg.conversationId?.substring(0, 8))
          if (msg.messageId && msg.senderId && msg.content) {
            const chatMessage: ChatMessage = {
              id: msg.messageId,
              senderId: msg.senderId,
              senderName: msg.senderName || 'Unknown',
              content: msg.content,
              timestamp: msg.timestamp || Date.now(),
              conversationId: msg.conversationId
            }
            
            // IMPORTANT: Only add to chat UI if this message is part of MY conversation
            // Check if the message involves me (I'm the sender or the message is from my conversation partner)
            const isMyMessage = msg.senderId === userId
            const isFromMyPartner = inConversationWithRef.current && msg.senderId === inConversationWithRef.current
            const isForMe = isMyMessage || isFromMyPartner
            
            if (isForMe) {
              // Add to conversation-specific messages (for the chat UI)
              // Check for duplicates by message ID to prevent double-adding
              setChatMessages(prev => {
                // Don't add if we already have this message
                if (prev.some(m => m.id === msg.messageId)) {
                  console.log('[CHAT_MESSAGE] Duplicate, skipping:', msg.messageId)
                  return prev
                }
                console.log('[CHAT_MESSAGE] Adding MY message, total now:', prev.length + 1)
                return [...prev, chatMessage]
              })
            } else {
              console.log('[CHAT_MESSAGE] Not my conversation, only adding to bubbles')
            }
            
            // Also track globally for all entity chat bubbles
            setAllEntityMessages(prev => {
              const next = new Map(prev)
              next.set(msg.senderId, chatMessage)
              return next
            })
            
            // Auto-clear the entity message after 6 seconds
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
            }, 6000)
            
            // If this is a response to our message (from an agent), stop waiting
            if (msg.senderId !== userId) {
              setIsWaitingForResponse(false)
            }
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

  const sendChatMessage = useCallback((content: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (!content.trim()) return
    
    ws.send(JSON.stringify({ type: 'CHAT_MESSAGE', content: content.trim() }))
    setIsWaitingForResponse(true)
    
    // Auto-reset waiting state after 10 seconds if no response comes
    setTimeout(() => {
      setIsWaitingForResponse(false)
    }, 10000)
  }, [])

  const respawn = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'RESPAWN' }))
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
    notification,
    chatMessages,
    isWaitingForResponse,
    allEntityMessages
  }

  const actions: GameSocketActions = {
    sendDirection,
    requestConversation,
    acceptConversation,
    rejectConversation,
    endConversation,
    clearNotification,
    sendChatMessage,
    respawn
  }

  return [state, actions]
}
