import React from 'react'

interface CellProps {
  children?: React.ReactNode
}

export default function Cell({ children }: CellProps) {
  return (
    <div className="w-4 h-4 bg-white flex items-center justify-center relative overflow-visible">
      {children}
    </div>
  )
}
