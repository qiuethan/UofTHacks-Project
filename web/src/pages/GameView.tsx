import { useState, useCallback, useMemo } from 'react'
import { 
  ConnectionStatus,
  IncomingRequests,
  ConversationChat
} from '../components'
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
      conversationPartnerId: entity.conversationPartnerId
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
    <div className="w-full h-[calc(100vh-64px)] overflow-hidden">
      {/* Error/Notification overlays */}
      {error && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded text-sm bg-red-900/50 text-red-400 border border-red-900/50">
          {error}
        </div>
      )}

      {notification && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded text-sm bg-blue-900/30 text-blue-100 animate-pulse border border-blue-900/50 flex justify-between items-center min-w-[300px]">
          <span>{notification}</span>
          <button onClick={clearNotification} className="ml-4 text-xs underline opacity-50 hover:opacity-100">Dismiss</button>
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
          myEntityId={myEntityId}
          isWaitingForResponse={isWaitingForResponse}
          onSendMessage={sendChatMessage}
          onEndConversation={endConversation}
        />
      )}

      {/* Nearby Entities Panel - Show when near someone and not in conversation */}
      {nearbyEntities.length > 0 && canStartConversation && !inConversationWith && !isWalkingToConversation && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-gray-900/90 backdrop-blur-md px-4 py-3 rounded-xl shadow-2xl border border-gray-700/50">
            <div className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-2 text-center">
              Nearby
            </div>
            <div className="flex gap-2 flex-wrap justify-center max-w-md">
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
                      px-4 py-2 rounded-lg text-sm font-medium transition-all
                      ${isBusy 
                        ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed' 
                        : 'bg-green-600/80 hover:bg-green-500 text-white shadow-lg hover:shadow-green-500/20 hover:scale-105'
                      }
                    `}
                  >
                    💬 {entity.displayName}
                    {isBusy && <span className="ml-1 text-xs opacity-70">(busy)</span>}
                  </button>
                )
              })}
            </div>
            {nearbyEntities.length > 5 && (
              <div className="text-gray-500 text-xs text-center mt-2">
                +{nearbyEntities.length - 5} more nearby
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status Modal - keeping logic but removing the trigger button from main flow */}
      {showStatusModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 p-8 rounded-3xl border border-gray-800 shadow-2xl max-w-sm w-full animate-in fade-in zoom-in duration-200">
            <h2 className="text-2xl font-bold text-gray-400 mb-4 text-center">World Simulation</h2>
            
            <div className="flex flex-col items-center gap-4 mb-6">
              <ConnectionStatus connected={connected} />
              <div className="text-gray-500 text-sm">
                Entity ID: <span className="font-mono text-gray-300">{myEntityId?.split('-')[0] || '...'}</span>
              </div>
            </div>

            <button
              onClick={() => setShowStatusModal(false)}
              className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors border border-gray-700"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
