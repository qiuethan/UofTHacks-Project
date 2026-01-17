import { Routes, Route, Link, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import GameView from './pages/GameView'
import WatchView from './pages/WatchView'
import CreateAvatar from './pages/CreateAvatar'
import Profile from './pages/Profile'
import Login from './pages/Login'

import Header from './components/Header'

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
      <Header />
      <main>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to="/watch" replace />} />
          <Route path="/play" element={<ProtectedRoute requireAvatar><GameView /></ProtectedRoute>} />
          <Route path="/watch" element={<WatchView />} />
          <Route path="/create" element={<ProtectedRoute><CreateAvatar /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute requireAvatar><Profile /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  )
}
