import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Landing() {
  const { user, hasAvatar } = useAuth()

  return (
    <div className="h-full relative overflow-hidden">
      {/* Background image with overlay */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
      />
      <div className="absolute inset-0 bg-black/50" />
      
      {/* Content */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center px-4">
        {/* Logo */}
        <img 
          src="/logo_white.png" 
          alt="Identity Matrix" 
          className="w-64 md:w-80 mb-8"
          style={{ imageRendering: 'pixelated' }}
        />
        
        {/* Tagline */}
        <p className="text-lg md:text-2xl text-white/90 text-center max-w-2xl mb-10 drop-shadow-md">
          Upload yourself into the matrix. Watch your AI counterpart live, 
          make friends, and navigate a world of its own.
        </p>
        
        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4">
          {user ? (
            hasAvatar ? (
              <>
                <Link 
                  to="/play" 
                  className="btn-primary px-8 py-4 text-lg font-bold text-white border-0"
                >
                  Enter the Matrix
                </Link>
                <Link 
                  to="/watch" 
                  className="btn-secondary px-8 py-4 text-lg font-bold text-black"
                >
                  Watch Mode
                </Link>
              </>
            ) : (
              <Link 
                to="/onboarding" 
                className="btn-primary px-8 py-4 text-lg font-bold text-white border-0"
              >
                Create Your Avatar
              </Link>
            )
          ) : (
            <>
              <Link 
                to="/login" 
                className="btn-primary px-8 py-4 text-lg font-bold text-white border-0"
              >
                Join Now
              </Link>
              <Link 
                to="/watch" 
                className="btn-secondary px-8 py-4 text-lg font-bold text-black"
              >
                Watch First
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
