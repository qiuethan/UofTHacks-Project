import { useState, useCallback } from 'react'
import { 
  ConnectionStatus,
  IncomingRequests,
  ActiveConversation
} from '../components'
import { PhaserGame } from '../game'
import { useAuth } from '../contexts/AuthContext'
import { useGameSocket } from '../hooks'
import type { GameEntity } from '../game/types'

export default function GameView() {
  const { user, session } = useAuth()
  const [showStatusModal, setShowStatusModal] = useState(false)

  // Game socket connection and state management
  const [gameState, gameActions] = useGameSocket({
    token: session?.access_token,
    userId: user?.id,
    displayName: user?.email?.split('@')[0] || 'Player'
  })

  const { 
    connected, 
    myEntityId, 
    mapSize, 
    entities, 
    inConversationWith,
    isWalkingToConversation,
    pendingRequests,
    notification,
    error 
  } = gameState

  const { 
    sendDirection, 
    acceptConversation, 
    rejectConversation, 
    endConversation,
    clearNotification
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
        inputEnabled={inputEnabled}
      />

      {/* Incoming Conversation Requests */}
      <IncomingRequests
        requests={pendingRequests}
        onAccept={acceptConversation}
        onReject={rejectConversation}
      />

      {/* In Conversation Indicator */}
      {inConversationWith && (
        <ActiveConversation
          partnerName={entities.get(inConversationWith)?.displayName || 'someone'}
          onEnd={endConversation}
        />
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
