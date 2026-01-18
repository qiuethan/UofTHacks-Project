import { useState, useEffect } from 'react'

interface GameLoadingProps {
  onComplete: () => void
  minDuration?: number
}

export default function GameLoading({ onComplete, minDuration = 2000 }: GameLoadingProps) {
  const [progress, setProgress] = useState(0)
  const [isFadingOut, setIsFadingOut] = useState(false)

  useEffect(() => {
    const startTime = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const newProgress = Math.min((elapsed / minDuration) * 100, 100)
      setProgress(prev => Math.max(prev, newProgress))

      if (newProgress >= 100) {
        clearInterval(interval)
        setIsFadingOut(true)
        setTimeout(() => {
          onComplete()
        }, 500)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [minDuration, onComplete])

  return (
    <div 
      className={`fixed left-0 right-0 bottom-0 top-[84px] bg-[#FFF8F0] z-[100] flex flex-col items-center justify-center transition-opacity duration-500 ${
        isFadingOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <div className="loading-bar-container w-64 h-4 overflow-hidden">
        <div 
          className="loading-bar-fill h-full transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-4 text-black font-semibold">Loading world...</p>
    </div>
  )
}
