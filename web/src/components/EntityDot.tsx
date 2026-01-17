interface EntityDotProps {
  isPlayer?: boolean
  color?: string
}

export default function EntityDot({ isPlayer = false, color }: EntityDotProps) {
  const bgColor = color || (isPlayer ? 'bg-green-400' : 'bg-black')
  
  return (
    <div
      className={`w-5 h-5 rounded-full ${color ? '' : bgColor}`}
      style={color ? { backgroundColor: color } : undefined}
    />
  )
}
