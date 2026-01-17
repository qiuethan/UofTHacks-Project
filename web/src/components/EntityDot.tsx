interface EntityDotProps {
  isPlayer?: boolean
  color?: string
  facing?: { x: number; y: number }
}

export default function EntityDot({ isPlayer = false, color, facing }: EntityDotProps) {
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
  
  return (
    <div
      className={`w-5 h-5 rounded-full ${color ? '' : bgColor} flex items-center justify-center`}
      style={{ backgroundColor: color }}
    >
      <span className="text-white text-xs font-bold leading-none select-none">
        {arrowChar}
      </span>
    </div>
  )
}
