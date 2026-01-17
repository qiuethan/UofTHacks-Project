import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Header() {
  const { user, signOut, loading, hasAvatar } = useAuth()

  return (
    <nav className="bg-gray-800 p-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex gap-6">
          <Link to="/play" className="text-white hover:text-green-400 font-medium">
            Play
          </Link>
          <Link to="/watch" className="text-white hover:text-green-400 font-medium">
            Watch
          </Link>
          {user && hasAvatar && (
            <Link to="/profile" className="text-white hover:text-green-400 font-medium">
              Profile
            </Link>
          )}
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
            <div className="flex gap-4">
              <Link 
                to="/login" 
                className="bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Sign In
              </Link>
              <Link 
                to="/login?mode=signup" 
                className="bg-green-600 hover:bg-green-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Sign Up
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  )
}
