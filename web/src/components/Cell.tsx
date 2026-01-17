import type { ReactNode } from 'react'

interface CellProps {
  children?: ReactNode
}

export default function Cell({ children }: CellProps) {
  return (
    <div className="w-8 h-8 bg-gray-700 flex items-center justify-center">
      {children}
    </div>
  )
}
