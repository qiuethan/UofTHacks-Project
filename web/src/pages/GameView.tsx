import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { 
  ConnectionStatus,
  IncomingRequests,
  ConversationChat,
  GameLoading
} from '../components'
import AgentSidebar from '../components/AgentSidebar'
import { PhaserGame } from '../game'
import { useAuth } from '../contexts/AuthContext'
import { useGameSocket } from '../hooks'
import { CONVERSATION_CONFIG, API_CONFIG } from '../config/constants'
import type { GameEntity, WorldLocation, PlayerActivityState } from '../game/types'
import type { Entity, LocationType } from '../types/game'
import { Utensils, Mic, Sofa, Users, Compass, MapPin, X, RotateCcw } from 'lucide-react'

// Location type colors for rendering
const LOCATION_COLORS: Record<LocationType, string> = {
  food: '#22c55e',       // green - eating
  karaoke: '#ec4899',    // pink - singing
  rest_area: '#3b82f6',  // blue - resting
  social_hub: '#f59e0b', // amber - socializing
  wander_point: '#8b5cf6' // purple - wandering
}

// Location type icons
const LOCATION_ICONS: Record<LocationType, React.ReactNode> = {
  food: <Utensils size={14} />,
  karaoke: <Mic size={14} />,
  rest_area: <Sofa size={14} />,
  social_hub: <Users size={14} />,
  wander_point: <Compass size={14} />
}

// Map location type to activity state
const LOCATION_TO_ACTIVITY: Record<LocationType, PlayerActivityState> = {
  food: 'eating',
  karaoke: 'singing',
  rest_area: 'resting',
  social_hub: 'socializing',
  wander_point: 'wandering'
}

export default function GameView() {
  console.log('[GameView] Rendering...')
  const { user, session } = useAuth()
  console.log('[GameView] Auth state:', { user: !!user, userId: user?.id, session: !!session, token: !!session?.access_token })
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  
  // World locations state
  const [worldLocations, setWorldLocations] = useState<WorldLocation[]>([])
  
  // Activity summary banner state
  const [activitySummary, setActivitySummary] = useState<string | null>(null)
  const [showSummaryBanner, setShowSummaryBanner] = useState(false)
  const summaryFetchedRef = useRef(false)
  
  // Player activity state
  const [playerActivityState, setPlayerActivityState] = useState<PlayerActivityState>('idle')
  const [currentLocationId, setCurrentLocationId] = useState<string | null>(null)
  const [activityEndTime, setActivityEndTime] = useState<number | null>(null)
  const [activityTimeLeft, setActivityTimeLeft] = useState<number>(0)
  const activityTimerRef = useRef<NodeJS.Timeout | null>(null)
  
  // Game socket connection and state management
  const [gameState, gameActions] = useGameSocket({
    token: session?.access_token,
    userId: user?.id,
    displayName: user?.email?.split('@')[0] || 'Player'
  })
  console.log('[GameView] Game state:', { connected: gameState.connected, myEntityId: gameState.myEntityId, entityCount: gameState.entities.size })

  const { 
    connected, 
    myEntityId, 
    mapSize, 
    entities, 
    inConversationWith,
    isWalkingToConversation,
    pendingRequests,
    notification,
    error,
    chatMessages,
    isWaitingForResponse,
    allEntityMessages
  } = gameState

  const { 
    sendDirection, 
    requestConversation,
    acceptConversation, 
    rejectConversation, 
    endConversation,
    clearNotification,
    sendChatMessage,
    respawn
  } = gameActions

  // Fetch world locations on mount
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/world/locations`)
        const data = await response.json()
        if (data.ok && data.data) {
          setWorldLocations(data.data)
          console.log('[GameView] Loaded world locations:', data.data.length)
        }
      } catch (err) {
        console.error('[GameView] Failed to fetch world locations:', err)
      }
    }
    fetchLocations()
  }, [])

  // Fetch activity summary when connected (only once per session)
  useEffect(() => {
    if (connected && myEntityId && !summaryFetchedRef.current) {
      summaryFetchedRef.current = true
      
      const fetchSummary = async () => {
        try {
          const response = await fetch(`${API_CONFIG.BASE_URL}/agent/${myEntityId}/activity-summary`)
          const data = await response.json()
          if (data.ok && data.summary) {
            setActivitySummary(data.summary)
            setShowSummaryBanner(true)
            
            // Hide banner after 5 seconds
            setTimeout(() => {
              setShowSummaryBanner(false)
            }, 5000)
          }
        } catch (err) {
          console.error('[GameView] Failed to fetch activity summary:', err)
        }
      }
      
      // Small delay to let the game load first
      setTimeout(fetchSummary, 500)
    }
  }, [connected, myEntityId])

  // Cleanup activity timer on unmount
  useEffect(() => {
    return () => {
      if (activityTimerRef.current) {
        clearTimeout(activityTimerRef.current)
      }
    }
  }, [])

  // Update activity time left every second
  useEffect(() => {
    if (!activityEndTime) {
      setActivityTimeLeft(0)
      return
    }
    
    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((activityEndTime - Date.now()) / 1000))
      setActivityTimeLeft(remaining)
    }
    
    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    
    return () => clearInterval(interval)
  }, [activityEndTime])

  // Update activity state based on conversation/movement
  useEffect(() => {
    if (inConversationWith) {
      setPlayerActivityState('talking')
      setCurrentLocationId(null)
    } else if (isWalkingToConversation) {
      setPlayerActivityState('walking')
      setCurrentLocationId(null)
    } else if (!currentLocationId) {
      // Only set to idle if not at a location
      setPlayerActivityState('idle')
    }
  }, [inConversationWith, isWalkingToConversation, currentLocationId])

  // Handle starting an activity at a location
  const startLocationActivity = useCallback(async (location: WorldLocation) => {
    const activity = LOCATION_TO_ACTIVITY[location.location_type]
    setPlayerActivityState(activity)
    setCurrentLocationId(location.id)
    
    // Set auto-leave timer
    const endTime = Date.now() + location.duration_seconds * 1000
    setActivityEndTime(endTime)
    
    // Clear any existing timer
    if (activityTimerRef.current) {
      clearTimeout(activityTimerRef.current)
    }
    
    // Notify API that we're starting an activity (for agent monitor visibility)
    if (myEntityId) {
      try {
        await fetch(`${API_CONFIG.BASE_URL}/agent/${myEntityId}/start-activity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location_type: location.location_type,
            location_id: location.id,
            location_name: location.name
          })
        })
      } catch (err) {
        console.error('[GameView] Failed to notify start activity:', err)
      }
    }
    
    // Set timer to auto-leave after duration
    activityTimerRef.current = setTimeout(() => {
      completeLocationActivity(location, false)
    }, location.duration_seconds * 1000)
    
    console.log(`[GameView] Started ${activity} at ${location.name} for ${location.duration_seconds}s`)
  }, [myEntityId])

  // Handle completing/leaving a location activity
  const completeLocationActivity = useCallback(async (location?: WorldLocation, leftEarly: boolean = false) => {
    // Calculate time spent and progress
    const timeSpent = activityEndTime && location 
      ? location.duration_seconds - Math.max(0, (activityEndTime - Date.now()) / 1000)
      : 0
    const progress = location ? Math.min(1, timeSpent / location.duration_seconds) : 0
    
    // Apply stat boost based on location effects
    if (location && myEntityId) {
      console.log(`[GameView] ${leftEarly ? 'Left early from' : 'Completed activity at'} ${location.name}`)
      console.log(`[GameView] Time spent: ${timeSpent.toFixed(1)}s / ${location.duration_seconds}s (${(progress * 100).toFixed(0)}% complete)`)
      
      // Call API to update user stats based on location type and progress
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/agent/${myEntityId}/complete-activity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location_type: location.location_type,
            location_id: location.id,
            effects: location.effects,
            progress: progress,  // 0.0 to 1.0 - how much of the activity was completed
            completed_full: !leftEarly
          })
        })
        const data = await response.json()
        if (data.ok) {
          console.log(`[GameView] Stats updated successfully:`, data.updated_stats)
        }
      } catch (err) {
        console.error('[GameView] Failed to update stats:', err)
      }
    }
    
    setPlayerActivityState('idle')
    setCurrentLocationId(null)
    setActivityEndTime(null)
    
    if (activityTimerRef.current) {
      clearTimeout(activityTimerRef.current)
      activityTimerRef.current = null
    }
  }, [myEntityId, activityEndTime])

  // Leave current location early
  const leaveCurrentLocation = useCallback(() => {
    const currentLocation = worldLocations.find(l => l.id === currentLocationId)
    completeLocationActivity(currentLocation, true) // leftEarly = true
  }, [currentLocationId, worldLocations, completeLocationActivity])
  
  // Handle direction changes from Phaser
  const handleDirectionChange = useCallback((dx: -1 | 0 | 1, dy: -1 | 0 | 1) => {
    sendDirection(dx, dy)
  }, [sendDirection])

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

  // Determine if input should be enabled (disable when at a location or in conversation)
  const inputEnabled = connected && !inConversationWith && !isWalkingToConversation && !currentLocationId

  // Calculate nearby entities (within conversation initiation radius)
  const nearbyEntities = useMemo(() => {
    if (!myEntityId) return []
    const me = entities.get(myEntityId)
    if (!me) return []
    
    const nearby: Entity[] = []
    for (const [id, entity] of entities) {
      if (id === myEntityId) continue
      if (entity.kind === 'WALL') continue
      
      // Calculate distance (center to center for 1x1 entities)
      const centerX1 = me.x + 0.5
      const centerY1 = me.y + 0.5
      const centerX2 = entity.x + 0.5
      const centerY2 = entity.y + 0.5
      const distance = Math.sqrt(
        Math.pow(centerX2 - centerX1, 2) + 
        Math.pow(centerY2 - centerY1, 2)
      )
      
      if (distance <= CONVERSATION_CONFIG.INITIATION_RADIUS) {
        nearby.push(entity)
      }
    }
    return nearby
  }, [entities, myEntityId])

  // Calculate nearby locations (within interaction radius)
  const nearbyLocations = useMemo(() => {
    if (!myEntityId) return []
    const me = entities.get(myEntityId)
    if (!me) return []
    
    const LOCATION_INTERACTION_RADIUS = 5 // Tiles
    
    const nearby: WorldLocation[] = []
    for (const location of worldLocations) {
      // Calculate distance from player center to location
      const centerX = me.x + 1
      const centerY = me.y + 0.5
      const distance = Math.sqrt(
        Math.pow(location.x - centerX, 2) + 
        Math.pow(location.y - centerY, 2)
      )
      
      if (distance <= LOCATION_INTERACTION_RADIUS) {
        nearby.push(location)
      }
    }
    return nearby
  }, [entities, myEntityId, worldLocations])

  // Check if my entity can start a conversation
  const myEntity = myEntityId ? entities.get(myEntityId) : null
  const canStartConversation = myEntity?.conversationState === 'IDLE' || !myEntity?.conversationState

  return (
    <div className="w-full h-[calc(100vh-64px)] overflow-hidden relative">
      {/* Loading Screen */}
      {isLoading && <GameLoading onComplete={() => setIsLoading(false)} minDuration={2000} />}

      {/* Error/Notification overlays */}
      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 text-sm bg-[#FFF8F0] text-black border-2 border-black shadow-[4px_4px_0_#000]">
          {error}
        </div>
      )}

      {notification && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 text-sm bg-[#FFF8F0] text-black border-2 border-black shadow-[4px_4px_0_#000] flex justify-between items-center min-w-[300px]">
          <span className="flex items-center gap-2">
            <span>
              {notification.includes('declined') ? '🚫' : 
               notification.includes('ended') ? '👋' : 
               notification.includes('rejected') ? '❌' : 'ℹ️'}
            </span>
            {notification}
          </span>
          <button onClick={clearNotification} className="ml-4 text-xs underline hover:no-underline">Dismiss</button>
        </div>
      )}

      {/* Activity Summary Banner - shows what agent did while away */}
      {showSummaryBanner && activitySummary && (
        <div 
          className="fixed top-1/3 left-1/2 -translate-x-1/2 z-[100] max-w-lg w-full mx-4 animate-fade-in"
          style={{
            animation: 'fadeInDown 0.5s ease-out'
          }}
        >
          <div className="bg-[#FFF8F0] border-2 border-black shadow-[6px_6px_0_#000] px-6 py-4 text-center">
            <p className="text-black text-sm font-medium leading-relaxed">
              {activitySummary}
            </p>
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes fadeInDown {
          from {
            opacity: 0;
            transform: translate(-50%, -20px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
      `}</style>

      {/* Phaser Game Canvas */}
      <PhaserGame
        entities={gameEntities}
        mapSize={mapSize}
        myEntityId={myEntityId}
        mode="play"
        onDirectionChange={handleDirectionChange}
        onRequestConversation={requestConversation}
        inputEnabled={inputEnabled}
        inConversationWith={inConversationWith}
        chatMessages={chatMessages}
        allEntityMessages={allEntityMessages}
        followEntityId={null}
        worldLocations={worldLocations}
        playerActivityState={playerActivityState}
        currentLocationId={currentLocationId}
      />

      {/* Respawn Button (top right, near profile) */}
      {connected && !inConversationWith && !isWalkingToConversation && (
        <div className="fixed top-20 right-6 z-50">
          <button
            onClick={respawn}
            className="px-3 py-1.5 text-xs font-medium bg-[#FFF8F0] text-black border-2 border-black shadow-[2px_2px_0_#000] hover:shadow-[1px_1px_0_#000] hover:translate-x-[1px] hover:translate-y-[1px] transition-all flex items-center gap-1.5"
            title="Respawn to center of map"
          >
            <RotateCcw size={12} />
            Respawn
          </button>
        </div>
      )}

      {/* Agent Sidebar */}
      <AgentSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onFollowAgent={() => {}} // No follow in play mode
        followingAgentId={null}
        entities={entities}
        myEntityId={myEntityId}
        myActivityState={playerActivityState}
      />

      {/* Incoming Conversation Requests */}
      <IncomingRequests
        requests={pendingRequests}
        onAccept={acceptConversation}
        onReject={rejectConversation}
      />

      {/* Chat UI when in conversation */}
      {inConversationWith && (
        <ConversationChat
          messages={chatMessages}
          partnerName={entities.get(inConversationWith)?.displayName || 'someone'}
          partnerSpriteUrl={entities.get(inConversationWith)?.sprites?.front}
          myEntityId={myEntityId}
          partnerId={inConversationWith}
          isWaitingForResponse={isWaitingForResponse}
          onSendMessage={sendChatMessage}
          onEndConversation={endConversation}
        />
      )}

      {/* Nearby Panels Container */}
      {(nearbyEntities.length > 0 || nearbyLocations.length > 0) && canStartConversation && !inConversationWith && !isWalkingToConversation && !currentLocationId && (
        <div className="fixed bottom-6 right-6 z-50 flex gap-3">
          {/* Nearby Events Panel */}
          {nearbyLocations.length > 0 && (
            <div className="bg-[#FFF8F0] border-2 border-black shadow-[4px_4px_0_#000] px-4 py-3">
              <div className="text-black text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                <MapPin size={12} /> Nearby Events
              </div>
              <div className="flex flex-col gap-2 min-w-[180px]">
                {nearbyLocations.slice(0, 5).map(location => (
                  <button
                    key={location.id}
                    onClick={() => startLocationActivity(location)}
                    className="px-3 py-2 text-sm font-medium transition-all border-2 border-black shadow-[2px_2px_0_#000] hover:shadow-[1px_1px_0_#000] hover:translate-x-[1px] hover:translate-y-[1px] flex items-center gap-2"
                    style={{ 
                      backgroundColor: LOCATION_COLORS[location.location_type],
                      color: 'white'
                    }}
                  >
                    {LOCATION_ICONS[location.location_type]}
                    {location.name}
                  </button>
                ))}
              </div>
              {nearbyLocations.length > 5 && (
                <div className="text-black/60 text-xs mt-2">
                  +{nearbyLocations.length - 5} more nearby
                </div>
              )}
            </div>
          )}

          {/* Nearby People Panel */}
          {nearbyEntities.length > 0 && (
            <div className="bg-[#FFF8F0] border-2 border-black shadow-[4px_4px_0_#000] px-4 py-3">
              <div className="text-black text-xs font-bold uppercase tracking-wider mb-2">
                Nearby People
              </div>
              <div className="flex flex-col gap-2 min-w-[180px]">
                {nearbyEntities.slice(0, 5).map(entity => {
                  const isBusy = entity.conversationState === 'IN_CONVERSATION' || 
                                 entity.conversationState === 'WALKING_TO_CONVERSATION' ||
                                 entity.conversationState === 'PENDING_REQUEST'
                  return (
                    <button
                      key={entity.entityId}
                      onClick={() => !isBusy && requestConversation(entity.entityId)}
                      disabled={isBusy}
                      className={`
                        px-3 py-2 text-sm font-medium transition-all border-2 border-black
                        ${isBusy 
                          ? 'bg-black/10 text-black/40 cursor-not-allowed' 
                          : 'btn-primary text-white shadow-[2px_2px_0_#000] hover:shadow-[1px_1px_0_#000] hover:translate-x-[1px] hover:translate-y-[1px]'
                        }
                      `}
                    >
                      {entity.displayName}
                      {isBusy && <span className="ml-1 text-xs">(busy)</span>}
                    </button>
                  )
                })}
              </div>
              {nearbyEntities.length > 5 && (
                <div className="text-black/60 text-xs mt-2">
                  +{nearbyEntities.length - 5} more nearby
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Current Activity Panel - Show when doing an activity at a location */}
      {currentLocationId && (
        <div className="fixed bottom-6 right-6 z-50">
          <div className="bg-[#FFF8F0] border-2 border-black shadow-[4px_4px_0_#000] px-4 py-3">
            {(() => {
              const location = worldLocations.find(l => l.id === currentLocationId)
              if (!location) return null
              const progress = activityEndTime ? Math.max(0, ((activityEndTime - Date.now()) / (location.duration_seconds * 1000)) * 100) : 0
              return (
                <>
                  <div className="text-black text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                    <span style={{ color: LOCATION_COLORS[location.location_type] }}>
                      {LOCATION_ICONS[location.location_type]}
                    </span>
                    {playerActivityState === 'eating' && 'Eating...'}
                    {playerActivityState === 'resting' && 'Resting...'}
                    {playerActivityState === 'socializing' && 'Socializing...'}
                    {playerActivityState === 'singing' && 'Singing...'}
                    {playerActivityState === 'wandering' && 'Exploring...'}
                  </div>
                  <div className="text-sm text-black mb-2">{location.name}</div>
                  <div className="text-xs text-black/60 mb-3">
                    {activityTimeLeft > 0 ? `${activityTimeLeft}s remaining` : 'Finishing...'}
                  </div>
                  <div className="w-full bg-black/10 border border-black h-2 mb-3">
                    <div 
                      className="h-full transition-all duration-300"
                      style={{ 
                        width: `${progress}%`,
                        backgroundColor: LOCATION_COLORS[location.location_type]
                      }}
                    />
                  </div>
                  <button
                    onClick={leaveCurrentLocation}
                    className="w-full px-3 py-2 text-sm font-medium bg-black/10 hover:bg-black/20 text-black border-2 border-black transition-all flex items-center justify-center gap-2"
                  >
                    <X size={14} /> Leave Early
                  </button>
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Status Modal - keeping logic but removing the trigger button from main flow */}
      {showStatusModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[#FFF8F0] border-2 border-black shadow-[8px_8px_0_#000] p-8 max-w-sm w-full">
            <h2 className="text-2xl font-bold text-black mb-4 text-center">Identity Matrix</h2>
            
            <div className="flex flex-col items-center gap-4 mb-6">
              <ConnectionStatus connected={connected} />
              <div className="text-black text-sm">
                Entity ID: <span className="font-mono">{myEntityId?.split('-')[0] || '...'}</span>
              </div>
            </div>

            <button
              onClick={() => setShowStatusModal(false)}
              className="btn-primary w-full py-2 text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
