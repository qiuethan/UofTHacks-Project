import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import GameView from './pages/GameView'
import WatchView from './pages/WatchView'
import Onboarding from './pages/Onboarding'
import Profile from './pages/Profile'
import Login from './pages/Login'
import Landing from './pages/Landing'
import CreateNPC from './pages/CreateNPC'

import Header from './components/Header'

function ProtectedRoute({
  children,
  requireAvatar = false,
  requireOnboarding = false
}: {
  children: React.ReactNode,
  requireAvatar?: boolean,
  requireOnboarding?: boolean
}) {
  const { user, loading, hasAvatar, checkingAvatar, onboardingCompleted } = useAuth()
  
  console.log('[ProtectedRoute] State:', { loading, checkingAvatar, hasAvatar, onboardingCompleted, user: !!user, requireAvatar, requireOnboarding })
  
  if (loading || checkingAvatar) {
    console.log('[ProtectedRoute] Showing loading because:', { loading, checkingAvatar })
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-black">Loading... (loading={String(loading)}, checkingAvatar={String(checkingAvatar)})</div>
      </div>
    )
  }
  
  if (!user) {
    console.log('[ProtectedRoute] No user, redirecting to /login')
    return <Navigate to="/login" replace />
  }
  
  // If route requires avatar and user doesn't have one, redirect to onboarding
  if (requireAvatar && hasAvatar === false) {
    console.log('[ProtectedRoute] No avatar, redirecting to /onboarding')
    return <Navigate to="/onboarding" replace />
  }

  // If route requires onboarding and user hasn't finished, redirect to onboarding
  if (requireOnboarding && !onboardingCompleted) {
    console.log('[ProtectedRoute] Onboarding not complete, redirecting to /onboarding')
    return <Navigate to="/onboarding" replace />
  }
  
  console.log('[ProtectedRoute] All checks passed, rendering children')
  return <>{children}</>
}

function AppContent() {
  const location = useLocation()
  const hideHeader = location.pathname === '/onboarding' || location.pathname === '/create'

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#FFF8F0]">
      {!hideHeader && <Header />}
      <main className="flex-1 overflow-auto relative">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Landing />} />
          <Route path="/play" element={<ProtectedRoute requireAvatar requireOnboarding><GameView /></ProtectedRoute>} />
          <Route path="/watch" element={<WatchView />} />
          {/* Secret NPC creation route - no auth required */}
          <Route path="/create" element={<CreateNPC />} />
          <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute requireAvatar><Profile /></ProtectedRoute>} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return <AppContent />
}
