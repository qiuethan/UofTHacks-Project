export interface EntityDotProps {
  isPlayer?: boolean
  color?: string
  facing?: { x: number; y: number }
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
  isSelected, 
  inConversation, 
  y = 0,
  kind = 'PLAYER',
  onClick
}: EntityDotProps) {
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

  const bgColor = color || (isPlayer ? '#4ade80' : '#f87171') // green-400 or red-400
  
  // Determine character based on facing
  let arrowChar = '↓' 
  
  if (facing) {
    if (facing.x === 0 && facing.y === -1) arrowChar = '↑'
    else if (facing.x === 1 && facing.y === 0) arrowChar = '→'
    else if (facing.x === 0 && facing.y === 1) arrowChar = '↓'
    else if (facing.x === -1 && facing.y === 0) arrowChar = '←'
  }
  
  const zIndex = 10 + y
  const ringClass = isSelected ? 'ring-2 ring-yellow-400' : inConversation ? 'ring-2 ring-blue-400' : ''
  
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
    >
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
