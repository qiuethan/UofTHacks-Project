import React from 'react'

export interface CellProps {
  children?: React.ReactNode
  onClick?: () => void
}

export default function Cell({ children, onClick }: CellProps) {
  return (
    <div 
      className={`w-4 h-4 bg-[#FFF8F0] flex items-center justify-center relative overflow-visible ${onClick ? 'cursor-pointer hover:bg-gray-100' : ''}`}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
