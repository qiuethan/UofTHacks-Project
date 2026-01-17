interface EntityDotProps {
  isPlayer?: boolean
  color?: string
  facing?: { x: number; y: number }
}

export default function EntityDot({ isPlayer = false, color, facing }: EntityDotProps) {
  const bgColor = color || (isPlayer ? 'bg-green-400' : 'bg-black')
  
  // Calculate rotation based on facing
  // Default is facing down (0, 1) -> 0 degrees?
  // Let's use 0 degrees = Up, 90 = Right, 180 = Down, 270 = Left
  let rotation = 0
  if (facing) {
    if (facing.x === 0 && facing.y === -1) rotation = 0 // Up
    else if (facing.x === 1 && facing.y === 0) rotation = 90 // Right
    else if (facing.x === 0 && facing.y === 1) rotation = 180 // Down
    else if (facing.x === -1 && facing.y === 0) rotation = 270 // Left
  }
  
  return (
    <div
      className={`w-5 h-5 rounded-full ${color ? '' : bgColor} flex items-center justify-center transition-transform duration-200`}
      style={{ 
        backgroundColor: color,
        transform: `rotate(${rotation}deg)`
      }}
    >
      {/* Arrow indicator */}
      <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[6px] border-b-white opacity-80 mb-1" />
    </div>
  )
}
