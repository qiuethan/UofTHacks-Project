import { useState, useCallback, useMemo } from 'react'
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
import { CONVERSATION_CONFIG } from '../config/constants'
import type { GameEntity } from '../game/types'
import type { Entity } from '../types/game'

export default function GameView() {
  console.log('[GameView] Rendering...')
  const { user, session } = useAuth()
  console.log('[GameView] Auth state:', { user: !!user, userId: user?.id, session: !!session, token: !!session?.access_token })
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
    sendChatMessage
  } = gameActions
  
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

  // Determine if input should be enabled
  const inputEnabled = connected && !inConversationWith && !isWalkingToConversation

  // Calculate nearby entities (within conversation initiation radius)
  const nearbyEntities = useMemo(() => {
    if (!myEntityId) return []
    const me = entities.get(myEntityId)
    if (!me) return []
    
    const nearby: Entity[] = []
    for (const [id, entity] of entities) {
      if (id === myEntityId) continue
      if (entity.kind === 'WALL') continue
      
      // Calculate distance (center to center for 2x1 entities)
      const centerX1 = me.x + 1
      const centerY1 = me.y + 0.5
      const centerX2 = entity.x + 1
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
      />

      {/* Agent Sidebar */}
      <AgentSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        onFollowAgent={() => {}} // No follow in play mode
        followingAgentId={null}
        entities={entities}
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

      {/* Nearby Entities Panel - Show when near someone and not in conversation */}
      {nearbyEntities.length > 0 && canStartConversation && !inConversationWith && !isWalkingToConversation && (
        <div className="fixed bottom-6 right-6 z-50">
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
