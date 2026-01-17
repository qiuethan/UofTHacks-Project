export interface EntityDotProps {
  isPlayer?: boolean
  color?: string
  facing?: { x: number; y: number }
  isSelected?: boolean
  inConversation?: boolean
}

export default function EntityDot({ isPlayer = false, color, facing, isSelected, inConversation }: EntityDotProps) {
  const bgColor = color || (isPlayer ? 'bg-green-400' : 'bg-black')
  
  // Determine character based on facing
  // Default (0,1) is Down
  let arrowChar = '↓' 
  
  if (facing) {
    if (facing.x === 0 && facing.y === -1) arrowChar = '↑'
    else if (facing.x === 1 && facing.y === 0) arrowChar = '→'
    else if (facing.x === 0 && facing.y === 1) arrowChar = '↓'
    else if (facing.x === -1 && facing.y === 0) arrowChar = '←'
  }
  
  // Build border classes for selection and conversation states
  const borderClass = isSelected ? 'ring-2 ring-yellow-400' : inConversation ? 'ring-2 ring-blue-400' : ''
  
  return (
    <div
      className={`absolute top-0 left-0 w-[calc(200%+1px)] h-[calc(200%+1px)] z-10 pointer-events-none rounded-full ${color ? '' : bgColor} flex items-center justify-center ${borderClass}`}
      style={{ backgroundColor: color }}
    >
      <span className="text-white text-xs font-bold leading-none select-none">
        {arrowChar}
      </span>
      {inConversation && (
        <span className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full text-[8px] text-white flex items-center justify-center">💬</span>
      )}
    </div>
  )
}
