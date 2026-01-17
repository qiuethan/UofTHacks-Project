import type { ReactNode } from 'react'

interface GridProps {
  width: number
  height: number
  children: ReactNode
  entityLayer?: ReactNode
}

export const CELL_SIZE = 16
export const GAP_SIZE = 1

export default function Grid({ width, children, entityLayer }: GridProps) {
  return (
    <div className="relative">
      <div
        className="grid gap-px bg-gray-300 border border-gray-300 rounded p-px"
        style={{ gridTemplateColumns: `repeat(${width}, ${CELL_SIZE}px)` }}
      >
        {children}
      </div>
      {/* Entity layer - positioned absolutely on top of grid */}
      {entityLayer && (
        <div 
          className="absolute pointer-events-none"
          style={{ 
            top: '1px', 
            left: '1px',
            // Each cell is CELL_SIZE + GAP_SIZE except the last one
          }}
        >
          <div className="pointer-events-auto">
            {entityLayer}
          </div>
        </div>
      )}
    </div>
  )
}
