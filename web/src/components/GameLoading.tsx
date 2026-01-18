import { useState, useEffect } from 'react'

interface GameLoadingProps {
  onComplete: () => void
  minDuration?: number
}

const loadingMessages = [
  "Initializing neural pathways...",
  "Uploading consciousness...",
  "Syncing with the matrix...",
  "Calibrating identity parameters...",
  "Establishing connections...",
  "Rendering your reality...",
  "Almost there..."
]

export default function GameLoading({ onComplete, minDuration = 3000 }: GameLoadingProps) {
  const [progress, setProgress] = useState(0)
  const [isFadingOut, setIsFadingOut] = useState(false)
  const [messageIndex, setMessageIndex] = useState(0)
  const [dots, setDots] = useState('')

  // Progress bar animation
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

  // Cycle through loading messages
  useEffect(() => {
    const messageInterval = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % loadingMessages.length)
    }, 800)

    return () => clearInterval(messageInterval)
  }, [])

  // Animate dots
  useEffect(() => {
    const dotInterval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.')
    }, 300)

    return () => clearInterval(dotInterval)
  }, [])

  return (
    <div 
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center transition-opacity duration-500 ${
        isFadingOut ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Background */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
      />
      <div className="absolute inset-0 bg-black/40" />
      
      {/* Content panel */}
      <div className="relative z-10 panel-fun p-8 md:p-12 flex flex-col items-center max-w-md mx-4 mt-16">
        {/* Logo */}
        <img 
          src="/logo.png" 
          alt="Identity Matrix" 
          className="w-40 md:w-56 mb-6"
          style={{ imageRendering: 'pixelated' }}
        />
        
        {/* Loading message */}
        <p className="text-black text-base mb-6 h-6 font-semibold text-center">
          {loadingMessages[messageIndex]}
        </p>
        
        {/* Progress bar - using app's loading bar style */}
        <div className="w-full mb-4">
          <div className="loading-bar-container w-full h-5 overflow-hidden">
            <div 
              className="loading-bar-fill h-full transition-all duration-100 relative"
              style={{ width: `${progress}%` }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
            </div>
          </div>
          
          {/* Progress info */}
          <div className="flex justify-between mt-3">
            <span className="text-black/60 text-sm font-bold">{Math.floor(progress)}%</span>
            <span className="text-black/60 text-sm font-bold">Entering Matrix{dots}</span>
          </div>
        </div>
        
        {/* Decorative loading dots */}
        <div className="flex gap-2 mt-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div 
              key={i}
              className="w-3 h-3 bg-[#007a28] border-2 border-[#005018] animate-bounce"
              style={{ 
                animationDelay: `${i * 100}ms`,
                animationDuration: '600ms'
              }}
            />
          ))}
        </div>
        
        {/* Tip text */}
        <p className="text-black/50 text-xs mt-6 text-center">
          Tip: Your AI counterpart will continue living even when you're away
        </p>
      </div>
    </div>
  )
}
