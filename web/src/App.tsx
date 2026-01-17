import { Routes, Route, Link, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import GameView from './pages/GameView'
import CreateAvatar from './pages/CreateAvatar'
import Login from './pages/Login'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }
  
  if (!user) {
    return <Navigate to="/login" replace />
  }
  
  return <>{children}</>
}

export default function App() {
  const { user, signOut, loading } = useAuth()

  return (
    <div className="min-h-screen">
      <nav className="bg-gray-800 p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex gap-6">
            <Link to="/" className="text-white hover:text-green-400 font-medium">
              Game
            </Link>
            <Link to="/create" className="text-white hover:text-green-400 font-medium">
              Create Avatar
            </Link>
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
          <Route path="/" element={<ProtectedRoute><GameView /></ProtectedRoute>} />
          <Route path="/create" element={<ProtectedRoute><CreateAvatar /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  )
}
