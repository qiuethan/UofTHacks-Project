import type { ReactNode } from 'react'

interface GridProps {
  width: number
  height: number
  children: ReactNode
}

export default function Grid({ width, children }: GridProps) {
  return (
    <div
      className="grid gap-px bg-gray-300 border border-gray-300 rounded p-px"
      style={{ gridTemplateColumns: `repeat(${width}, 16px)` }}
    >
      {children}
    </div>
  )
}
