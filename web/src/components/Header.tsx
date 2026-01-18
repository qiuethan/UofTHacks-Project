import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useState } from 'react'

export default function Header() {
  const { user, signOut, loading, hasAvatar } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)

  const isPlayMode = location.pathname === '/play'
  const isWatchMode = location.pathname === '/watch'
  const isProfileMode = location.pathname === '/profile'
  const isLoginMode = location.pathname === '/login'

  const handleToggle = (mode: 'play' | 'watch') => {
    navigate(`/${mode}`)
  }

  return (
    <nav className="navbar-fun p-4 relative z-[200]">
      <div className="max-w-6xl mx-auto flex items-center justify-between" style={{ paddingTop: '4px', paddingBottom: '8px' }}>
        <div className="flex items-center gap-6">
          {/* Watch button when logged out */}
          {!user && (
            <Link to="/watch" className={`px-4 py-1.5 text-sm font-semibold ${
              isWatchMode ? 'btn-tertiary btn-active text-white' : 'btn-primary text-white'
            }`}>
              Watch
            </Link>
          )}
          {/* Play/Watch toggle - only shows when logged in with avatar */}
          {user && hasAvatar && (
            <div className="flex gap-2">
              <button
                onClick={() => handleToggle('play')}
                className={`px-4 py-1.5 text-sm font-semibold ${
                  isPlayMode ? 'btn-tertiary btn-active text-white' : 'btn-primary text-white'
                }`}
              >
                Play
              </button>
              <button
                onClick={() => handleToggle('watch')}
                className={`px-4 py-1.5 text-sm font-semibold ${
                  isWatchMode ? 'btn-tertiary btn-active text-white' : 'btn-primary text-white'
                }`}
              >
                Watch
              </button>
            </div>
          )}
          {user && !hasAvatar && (
            <Link to="/onboarding" className="btn-primary px-4 py-1.5 text-sm font-semibold text-white">
              Get Started
            </Link>
          )}
        </div>

        {/* Center logo */}
        <Link to="/" className="absolute left-1/2 -translate-x-1/2">
          <img src="/logo.png" alt="Logo" className="h-12" style={{ imageRendering: 'pixelated' }} />
        </Link>
        <div className="flex items-center gap-4">
          {!loading && user ? (
            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className={`text-sm font-semibold px-4 py-2 text-white ${
                  isProfileMode ? 'btn-tertiary btn-active' : 'btn-primary'
                }`}
              >
                Profile
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 dropdown-menu z-[9999] min-w-[150px] overflow-hidden py-1">
                  {hasAvatar && (
                    <Link
                      to="/profile"
                      onClick={() => setProfileOpen(false)}
                      className="dropdown-item text-sm text-black"
                    >
                      View Profile
                    </Link>
                  )}
                  <button
                    onClick={() => {
                      setProfileOpen(false)
                      signOut()
                    }}
                    className="dropdown-item dropdown-item-danger w-full text-left text-sm"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          ) : !loading ? (
            <Link 
              to="/login" 
              className={`text-white text-sm font-semibold px-5 py-2 border-0 ${
                isLoginMode ? 'btn-tertiary btn-active' : 'btn-primary'
              }`}
            >
              Join
            </Link>
          ) : null}
        </div>
      </div>
    </nav>
  )
}
