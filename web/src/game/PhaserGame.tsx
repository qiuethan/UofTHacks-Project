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
  inputEnabled = true
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
    inputEnabled
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
      inputEnabled
    }
    
    // Update the running scene with new data
    if (gameRef.current) {
      const scene = gameRef.current.scene.getScene('GameScene') as GameScene
      if (scene && scene.updateEntities) {
        scene.updateEntities(entities, myEntityId || null)
      }
    }
  }, [entities, mapSize, myEntityId, mode, onDirectionChange, inputEnabled])

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
