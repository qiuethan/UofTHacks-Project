import { useState, useCallback } from 'react'
import { 
  Grid, 
  Cell, 
  EntityDot, 
  ConnectionStatus,
  ConversationRequestDialog,
  IncomingRequests,
  ActiveConversation
} from '../components'
import { useAuth } from '../contexts/AuthContext'
import { useGameSocket, useKeyboardInput } from '../hooks'
import type { Entity } from '../types/game'

export default function GameView() {
  const { user, session } = useAuth()
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null)

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
    error, 
    pendingRequests, 
    inConversationWith 
  } = gameState

  // Keyboard input for movement
  const handleDirectionChange = useCallback((direction: { x: -1 | 0 | 1; y: -1 | 0 | 1 }) => {
    gameActions.sendDirection(direction.x, direction.y)
  }, [gameActions])

  useKeyboardInput({
    onDirectionChange: handleDirectionChange,
    enabled: connected && !inConversationWith
  })

  // Build grid cells using components
  const cells = []
  for (let y = 0; y < mapSize.height; y++) {
    for (let x = 0; x < mapSize.width; x++) {
      // Find entity at top-left (x, y)
      const entityHere = Array.from(entities.values()).find(e => e.x === x && e.y === y)
      
      // Also check if this cell is part of a 2x2 entity (check all 4 possible top-left positions)
      const entityOccupyingCell = Array.from(entities.values()).find(e => {
        return x >= e.x && x <= e.x + 1 && y >= e.y && y <= e.y + 1
      })
      
      const isMe = entityHere?.entityId === myEntityId
      const isSelected = entityHere?.entityId === selectedEntity?.entityId
      const canInitiateConversation = entityOccupyingCell && !isMe && entityOccupyingCell.kind !== 'WALL' && !inConversationWith && entityOccupyingCell.entityId !== myEntityId
      
      cells.push(
        <Cell 
          key={`${x}-${y}`}
          onClick={() => {
            if (canInitiateConversation) {
              setSelectedEntity(entityOccupyingCell)
            }
          }}
        >
          {entityHere && (
            <EntityDot 
              isPlayer={isMe} 
              color={entityHere.color} 
              facing={entityHere.facing}
              isSelected={isSelected}
              inConversation={entityHere.conversationState === 'IN_CONVERSATION'}
            />
          )}
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
        Use arrow keys or WASD to move. Click on another player to request conversation.
      </p>

      {/* Conversation Request Popup */}
      {selectedEntity && !inConversationWith && (
        <ConversationRequestDialog
          entity={selectedEntity}
          onConfirm={() => {
            gameActions.requestConversation(selectedEntity.entityId)
            setSelectedEntity(null)
          }}
          onCancel={() => setSelectedEntity(null)}
        />
      )}

      {/* Incoming Conversation Requests */}
      <IncomingRequests
        requests={pendingRequests}
        onAccept={gameActions.acceptConversation}
        onReject={gameActions.rejectConversation}
      />

      {/* In Conversation Indicator */}
      {inConversationWith && (
        <ActiveConversation
          partnerName={entities.get(inConversationWith)?.displayName || 'someone'}
          onEnd={gameActions.endConversation}
        />
      )}
    </div>
  )
}
