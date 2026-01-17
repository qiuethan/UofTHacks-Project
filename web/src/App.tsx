import { Routes, Route, Link, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import GameView from './pages/GameView'
import WatchView from './pages/WatchView'
import CreateAvatar from './pages/CreateAvatar'
import Login from './pages/Login'

function ProtectedRoute({ children, requireAvatar = false }: { children: React.ReactNode, requireAvatar?: boolean }) {
  const { user, loading, hasAvatar, checkingAvatar } = useAuth()
  
  if (loading || checkingAvatar) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }
  
  if (!user) {
    return <Navigate to="/login" replace />
  }
  
  // If route requires avatar and user doesn't have one, redirect to create
  if (requireAvatar && hasAvatar === false) {
    return <Navigate to="/create" replace />
  }
  
  return <>{children}</>
}

export default function App() {
  const { user, signOut, loading, hasAvatar } = useAuth()

  return (
    <div className="min-h-screen">
      <nav className="bg-gray-800 p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex gap-6">
            <Link to="/play" className="text-white hover:text-green-400 font-medium">
              Play
            </Link>
            <Link to="/watch" className="text-white hover:text-green-400 font-medium">
              Watch
            </Link>
            {user && !hasAvatar && (
              <Link to="/create" className="text-yellow-400 hover:text-yellow-300 font-medium">
                Create Avatar
              </Link>
            )}
          </div>
          <div className="flex items-center gap-4">
            {!loading && user ? (
              <>
                <span className="text-gray-400 text-sm">{user.email}</span>
                <button
                  onClick={() => signOut()}
                  className="text-sm text-red-400 hover:text-red-300"
                >
                  Sign Out
                </button>
              </>
            ) : !loading ? (
              <Link to="/login" className="text-green-400 hover:text-green-300 text-sm">
                Sign In
              </Link>
            ) : null}
          </div>
        </div>
      </nav>
      <main>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to="/watch" replace />} />
          <Route path="/play" element={<ProtectedRoute requireAvatar><GameView /></ProtectedRoute>} />
          <Route path="/watch" element={<WatchView />} />
          <Route path="/create" element={<ProtectedRoute><CreateAvatar /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  )
}
