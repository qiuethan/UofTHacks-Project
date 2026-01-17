import { useEffect, useRef, useCallback } from 'react'
import type { Direction } from '../types/game'

interface UseKeyboardInputOptions {
  onDirectionChange: (direction: Direction) => void
  enabled?: boolean
}

/**
 * Hook for handling keyboard input for movement.
 * Uses a stack-based approach for smooth directional input.
 */
export function useKeyboardInput({ onDirectionChange, enabled = true }: UseKeyboardInputOptions) {
  const pressedKeysRef = useRef<string[]>([])
  const lastSentDirection = useRef<Direction>({ x: 0, y: 0 })

  const updateDirection = useCallback(() => {
    if (!enabled) return

    let dx: -1 | 0 | 1 = 0
    let dy: -1 | 0 | 1 = 0

    // Process keys in reverse order (most recent first)
    for (let i = pressedKeysRef.current.length - 1; i >= 0; i--) {
      const key = pressedKeysRef.current[i]
      switch (key) {
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
      onDirectionChange({ x: dx, y: dy })
    }
  }, [enabled, onDirectionChange])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid duplicates
      if (!pressedKeysRef.current.includes(e.key)) {
        pressedKeysRef.current.push(e.key)
        updateDirection()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      // Remove from stack
      const index = pressedKeysRef.current.indexOf(e.key)
      if (index > -1) {
        pressedKeysRef.current.splice(index, 1)
        updateDirection()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [updateDirection])

  // Reset on disable
  useEffect(() => {
    if (!enabled) {
      pressedKeysRef.current = []
      lastSentDirection.current = { x: 0, y: 0 }
    }
  }, [enabled])
}
