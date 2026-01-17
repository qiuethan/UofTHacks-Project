import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  hasAvatar: boolean | null
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
  const [checkingAvatar, setCheckingAvatar] = useState(false)

  const checkAvatarStatus = async (userId: string) => {
    setCheckingAvatar(true)
    try {
      // Use raw fetch to bypass schema cache issues with new columns
      const session = await supabase.auth.getSession()
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_positions?user_id=eq.${userId}&select=has_avatar`,
        {
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${session.data.session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`
          }
        }
      )
      
      if (response.ok) {
        const data = await response.json()
        setHasAvatar(data?.[0]?.has_avatar === true)
      } else {
        setHasAvatar(false)
      }
    } catch {
      setHasAvatar(false)
    } finally {
      setCheckingAvatar(false)
    }
  }

  const refreshAvatarStatus = async () => {
    if (user) {
      await checkAvatarStatus(user.id)
    }
  }

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        checkAvatarStatus(session.user.id)
      }
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        checkAvatarStatus(session.user.id)
      } else {
        setHasAvatar(null)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
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
  }

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      loading, 
      hasAvatar, 
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
