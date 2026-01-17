import { useState } from 'react'
import type { SpriteUrls } from '../types/game'

export interface EntityDotProps {
  isPlayer?: boolean
  color?: string
  facing?: { x: number; y: number }
  sprites?: SpriteUrls
  displayName?: string
  isSelected?: boolean
  inConversation?: boolean
  y?: number
  kind?: 'PLAYER' | 'WALL' | 'ROBOT'
  onClick?: () => void
}

export default function EntityDot({ 
  isPlayer = false, 
  color, 
  facing, 
  sprites,
  displayName,
  isSelected, 
  inConversation, 
  y = 0,
  kind = 'PLAYER',
  onClick
}: EntityDotProps) {
  const [isHovered, setIsHovered] = useState(false)
  // Walls are simple grey squares
  if (kind === 'WALL') {
    return (
      <div
        className={`absolute top-0 left-0 w-[calc(200%+1px)] h-[calc(200%+1px)] bg-gray-400 rounded-sm border border-gray-500 shadow-sm ${onClick ? 'cursor-pointer' : ''}`}
        style={{ zIndex: 10 + y }}
        onClick={(e) => {
          if (onClick) {
            e.stopPropagation()
            onClick()
          }
        }}
      />
    )
  }

  // Determine which sprite to show based on facing direction
  const getSpriteUrl = (): string | undefined => {
    if (!sprites) return undefined
    
    if (facing) {
      if (facing.x === 0 && facing.y === -1) return sprites.back   // Up = back view
      if (facing.x === 1 && facing.y === 0) return sprites.right   // Right
      if (facing.x === 0 && facing.y === 1) return sprites.front   // Down = front view
      if (facing.x === -1 && facing.y === 0) return sprites.left   // Left
    }
    
    return sprites.front // Default to front
  }

  const spriteUrl = getSpriteUrl()
  const hasSprite = !!spriteUrl

  const bgColor = color || (isPlayer ? '#4ade80' : '#f87171') // green-400 or red-400
  
  // Determine arrow character based on facing (for fallback display)
  let arrowChar = '↓' 
  if (facing) {
    if (facing.x === 0 && facing.y === -1) arrowChar = '↑'
    else if (facing.x === 1 && facing.y === 0) arrowChar = '→'
    else if (facing.x === 0 && facing.y === 1) arrowChar = '↓'
    else if (facing.x === -1 && facing.y === 0) arrowChar = '←'
  }
  
  const zIndex = 10 + y
  const ringClass = isSelected ? 'ring-2 ring-yellow-400' : inConversation ? 'ring-2 ring-blue-400' : ''
  
  // If entity has sprites, render the sprite image
  if (hasSprite) {
    return (
      <div
        className={`absolute left-0 w-[calc(200%+1px)] h-[calc(400%+1px)] ${ringClass} ${onClick ? 'cursor-pointer' : ''}`}
        style={{ 
          top: '-200%', 
          zIndex 
        }}
        onClick={(e) => {
          if (onClick) {
            e.stopPropagation()
            onClick()
          }
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Display name tooltip on hover */}
        {isHovered && displayName && (
          <div 
            className="absolute left-1/2 -translate-x-1/2 -top-6 px-2 py-1 bg-gray-900/90 text-white text-xs font-medium rounded whitespace-nowrap pointer-events-none shadow-lg border border-gray-700"
            style={{ zIndex: zIndex + 100 }}
          >
            {displayName}
          </div>
        )}
        <img
          src={spriteUrl}
          alt="avatar"
          className="w-full h-full object-contain"
          style={{ imageRendering: 'pixelated' }}
          draggable={false}
        />
        {inConversation && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full text-[10px] text-white flex items-center justify-center ring-2 ring-white shadow-lg">
            💬
          </span>
        )}
      </div>
    )
  }

  // Fallback: colored rectangle with arrow (original behavior)
  return (
    <div
      className={`absolute left-0 w-[calc(200%+1px)] h-[calc(400%+1px)] flex flex-col ${ringClass} ${onClick ? 'cursor-pointer' : ''}`}
      style={{ 
        top: '-200%', 
        zIndex 
      }}
      onClick={(e) => {
        if (onClick) {
          e.stopPropagation()
          onClick()
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Display name tooltip on hover */}
      {isHovered && displayName && (
        <div 
          className="absolute left-1/2 -translate-x-1/2 -top-6 px-2 py-1 bg-gray-900/90 text-white text-xs font-medium rounded whitespace-nowrap pointer-events-none shadow-lg border border-gray-700"
          style={{ zIndex: zIndex + 100 }}
        >
          {displayName}
        </div>
      )}
      <div 
        className="w-full h-1/2 rounded-t-lg opacity-90 shadow-sm"
        style={{ backgroundColor: bgColor }}
      />
      <div 
        className="w-full h-1/2 rounded-b-sm flex items-center justify-center relative shadow-sm"
        style={{ backgroundColor: bgColor }}
      >
        <span className="text-white text-xs font-bold leading-none select-none drop-shadow-sm">
          {arrowChar}
        </span>
        {inConversation && (
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full text-[8px] text-white flex items-center justify-center ring-1 ring-white">💬</span>
        )}
      </div>
    </div>
  )
}
