import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { signIn, signUp, user, hasAvatar, checkingAvatar } = useAuth()
  const navigate = useNavigate()
  
  // Check for mode=signup query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('mode') === 'signup') {
      setIsSignUp(true)
    }
  }, [])

  // Redirect if user is already logged in
  useEffect(() => {
    if (user && !checkingAvatar) {
      if (hasAvatar) {
        navigate('/play')
      } else {
        navigate('/create')
      }
    }
  }, [user, hasAvatar, checkingAvatar, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (isSignUp) {
        const { error, isNewUser } = await signUp(email, password)
        if (error) {
          setError(error.message)
        } else if (isNewUser) {
          // New users go to create avatar
          navigate('/create')
        }
      } else {
        const { error } = await signIn(email, password)
        if (error) {
          setError(error.message)
        }
        // Existing users will be redirected by useEffect based on hasAvatar
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center p-4 relative">
      {/* Background image with dark overlay */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
      />
      <div className="absolute inset-0 bg-black/40" />
      
      {/* Content */}
      <div className="panel-fun p-8 w-full max-w-md relative z-10">
        <h1 className="text-3xl font-bold mb-2 text-center text-black">
          {isSignUp ? 'Join Identity Matrix' : 'Welcome Back'}
        </h1>
        <p className="text-black text-center mb-6">
          {isSignUp ? 'Create an account to enter the Identity Matrix' : 'Sign in to continue your adventure'}
        </p>

        {error && (
          <div className="alert alert-error mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-black mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input-fun w-full px-4 py-3 text-black"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-black mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="input-fun w-full px-4 py-3 text-black"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3 text-white font-bold border-0 disabled:opacity-50 disabled:transform-none disabled:shadow-none"
          >
            {loading ? 'Loading...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-black text-sm">
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-black underline hover:no-underline font-medium"
          >
            {isSignUp ? 'Sign In' : 'Sign Up'}
          </button>
        </p>
      </div>
    </div>
  )
}
