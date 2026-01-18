import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  hasAvatar: boolean | null
  onboardingCompleted: boolean
  checkingAvatar: boolean
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signUp: (email: string, password: string) => Promise<{ error: Error | null; isNewUser?: boolean }>
  signOut: () => Promise<void>
  refreshAvatarStatus: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasAvatar, setHasAvatar] = useState<boolean | null>(null)
  const [onboardingCompleted, setOnboardingCompleted] = useState(false)
  const [checkingAvatar, setCheckingAvatar] = useState(false)

  const checkAvatarStatus = async (userId: string, accessToken?: string) => {
    console.log('[Auth] checkAvatarStatus starting for:', userId)
    setCheckingAvatar(true)
    try {
      // Use raw fetch to bypass schema cache issues with new columns
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_positions?user_id=eq.${userId}&select=has_avatar`,
        {
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_ANON_KEY}`
          }
        }
      )
      
      console.log('[Auth] Avatar check response status:', response.status)
      if (response.ok) {
        const data = await response.json()
        console.log('[Auth] Avatar check data:', data)
        setHasAvatar(data?.[0]?.has_avatar === true)
      } else {
        console.log('[Auth] Avatar check failed, response not ok')
        setHasAvatar(false)
      }
    } catch (error) {
      console.error('[Auth] Avatar check error:', error)
      setHasAvatar(false)
    } finally {
      console.log('[Auth] checkAvatarStatus complete, setting checkingAvatar=false')
      setCheckingAvatar(false)
    }
  }

  const refreshAvatarStatus = async () => {
    if (user && session) {
      // Refresh session from server to get updated user metadata
      const { data: { session: refreshedSession } } = await supabase.auth.refreshSession()
      if (refreshedSession?.user) {
        setUser(refreshedSession.user)
        setSession(refreshedSession)
        setOnboardingCompleted(refreshedSession.user.user_metadata?.onboarding_completed === true)
        await checkAvatarStatus(user.id, refreshedSession.access_token)
      } else {
        await checkAvatarStatus(user.id, session.access_token)
      }
    }
  }

  useEffect(() => {
    let isMounted = true
    
    // Set a safety timeout in case onAuthStateChange never fires
    const safetyTimeout = setTimeout(() => {
      if (isMounted && loading) {
        console.warn('[Auth] Safety timeout - forcing loading=false')
        setLoading(false)
      }
    }, 3000)

    // onAuthStateChange fires immediately with current session on setup
    // This is the recommended Supabase pattern - no need for getSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth] onAuthStateChange:', event, session?.user?.email || 'no user')
      
      if (!isMounted) return
      
      try {
        setSession(session)
        if (session?.user) {
          // Use session user directly to avoid additional async calls that might hang
          setUser(session.user)
          setOnboardingCompleted(session.user.user_metadata?.onboarding_completed === true)
          await checkAvatarStatus(session.user.id, session.access_token)
        } else {
          setUser(null)
          setHasAvatar(null)
          setOnboardingCompleted(false)
        }
      } catch (error) {
        console.error('[Auth] onAuthStateChange error:', error)
        if (isMounted) setUser(null)
      } finally {
        if (isMounted) {
          clearTimeout(safetyTimeout)
          setLoading(false)
        }
      }
    })

    return () => {
      isMounted = false
      clearTimeout(safetyTimeout)
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error as Error | null }
  }

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password })
    return { error: error as Error | null, isNewUser: !error }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setHasAvatar(null)
    setOnboardingCompleted(false)
  }

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      loading, 
      hasAvatar,
      onboardingCompleted, 
      checkingAvatar,
      signIn, 
      signUp, 
      signOut,
      refreshAvatarStatus
    }}>
      {children}
    </AuthContext.Provider>
  )
}
