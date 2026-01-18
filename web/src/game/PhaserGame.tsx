import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import Phaser from 'phaser'
import { createGameConfig } from './config'
import { PreloadScene } from './scenes/PreloadScene'
import { GameScene } from './scenes/GameScene'
import type { GameProps, SceneData } from './types'

// Calculate viewport size - can be called synchronously
const getViewportSize = () => ({
  width: typeof window !== 'undefined' ? window.innerWidth : 800,
  height: typeof window !== 'undefined' ? window.innerHeight - 64 : 600
})

export default function PhaserGame({
  entities,
  mapSize,
  myEntityId,
  mode,
  onDirectionChange,
  onRequestConversation,
  inputEnabled = true,
  inConversationWith,
  chatMessages = [],
  allEntityMessages = new Map(),
  watchZoom,
  watchPan,
  followEntityId = null,
  worldLocations = [],
  playerActivityState = 'idle',
  currentLocationId = null
}: GameProps) {
  const gameRef = useRef<Phaser.Game | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Initialize with correct size immediately
  const [containerSize, setContainerSize] = useState(getViewportSize)
  const [isReady, setIsReady] = useState(false)
  const sceneDataRef = useRef<SceneData>({
    entities,
    mapSize,
    myEntityId,
    mode,
    onDirectionChange,
    onRequestConversation,
    inputEnabled,
    inConversationWith,
    chatMessages,
    allEntityMessages,
    watchZoom,
    watchPan,
    followEntityId,
    worldLocations,
    playerActivityState,
    currentLocationId
  })

  // Use layout effect to set size before paint
  useLayoutEffect(() => {
    const updateSize = () => {
      const size = getViewportSize()
      setContainerSize(size)
    }
    
    updateSize()
    // Mark as ready after first size calculation
    setIsReady(true)
    
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  const viewportWidth = containerSize.width
  const viewportHeight = containerSize.height

  // Keep sceneData ref updated
  useEffect(() => {
    sceneDataRef.current = {
      entities,
      mapSize,
      myEntityId,
      mode,
      onDirectionChange,
      onRequestConversation,
      inputEnabled,
      inConversationWith,
      chatMessages,
      allEntityMessages,
      watchZoom,
      watchPan,
      followEntityId,
      worldLocations,
      playerActivityState,
      currentLocationId
    }
    
    // Update the running scene with new data
    if (gameRef.current) {
      const scene = gameRef.current.scene.getScene('GameScene') as GameScene
      if (scene && scene.updateEntities) {
        scene.updateEntities(entities, myEntityId || null)
      }
      // Update chat bubbles when messages change
      if (scene && scene.updateChatBubbles) {
        scene.updateChatBubbles(chatMessages, inConversationWith)
      }
      // Update all entity chat bubbles
      if (scene && scene.updateAllEntityBubbles) {
        scene.updateAllEntityBubbles(allEntityMessages)
      }
      // Update camera for watch mode zoom/pan
      if (scene && scene.updateWatchCamera && mode === 'watch') {
        scene.updateWatchCamera(watchZoom, watchPan)
      }
      // Update world locations
      if (scene && scene.updateWorldLocations) {
        scene.updateWorldLocations(worldLocations)
      }
    }
  }, [entities, mapSize, myEntityId, mode, onDirectionChange, onRequestConversation, inputEnabled, inConversationWith, chatMessages, allEntityMessages, watchZoom, watchPan, followEntityId, worldLocations, playerActivityState, currentLocationId])

  // Handle follow entity changes
  useEffect(() => {
    if (gameRef.current) {
      const scene = gameRef.current.scene.getScene('GameScene') as GameScene
      if (scene && scene.followEntity) {
        scene.followEntity(followEntityId ?? null)
      }
    }
  }, [followEntityId])

  // Listen for conversation initiation events from Phaser
  useEffect(() => {
    const handleInitiateConversation = (event: CustomEvent<{ targetEntityId: string }>) => {
      if (onRequestConversation && event.detail.targetEntityId) {
        onRequestConversation(event.detail.targetEntityId)
      }
    }

    window.addEventListener('initiateConversation', handleInitiateConversation as EventListener)
    return () => {
      window.removeEventListener('initiateConversation', handleInitiateConversation as EventListener)
    }
  }, [onRequestConversation])

  // Initialize Phaser game - wait until size is ready
  useEffect(() => {
    if (!containerRef.current || gameRef.current || !isReady) return

    const containerId = 'phaser-game-container'
    containerRef.current.id = containerId

    // Create scenes with access to sceneDataRef
    const preloadScene = new PreloadScene()
    const gameScene = new GameScene(sceneDataRef)

    const config = createGameConfig(containerId, viewportWidth, viewportHeight, [preloadScene, gameScene])
    gameRef.current = new Phaser.Game(config)

    return () => {
      if (gameRef.current) {
        gameRef.current.destroy(true)
        gameRef.current = null
      }
    }
  }, [isReady]) // Initialize once ready

  // Update game size when viewport changes
  useEffect(() => {
    if (gameRef.current) {
      gameRef.current.scale.resize(viewportWidth, viewportHeight)
    }
  }, [viewportWidth, viewportHeight])

  return (
    <div 
      ref={containerRef}
      className="overflow-hidden transition-opacity duration-300"
      style={{
        width: viewportWidth,
        height: viewportHeight,
        opacity: isReady ? 1 : 0
      }}
    />
  )
}
