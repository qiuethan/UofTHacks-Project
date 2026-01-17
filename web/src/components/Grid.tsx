import type { ReactNode } from 'react'

interface GridProps {
  width: number
  height: number
  children: ReactNode
}

export default function Grid({ width, children }: GridProps) {
  return (
    <div
      className="grid gap-px bg-gray-600 border-2 border-gray-500 rounded p-px"
      style={{ gridTemplateColumns: `repeat(${width}, 32px)` }}
    >
      {children}
    </div>
  )
}
