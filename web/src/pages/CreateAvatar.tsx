import { useState, useEffect } from 'react'
import { API_CONFIG } from '../config'

interface Avatar {
  id: string
  name: string
  sprite_path: string | null
  color: string
  bio: string | null
  created_at: string
  updated_at: string
}

export default function CreateAvatar() {
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  
  // Form state
  const [name, setName] = useState('')
  const [color, setColor] = useState('#000000')
  const [bio, setBio] = useState('')
  const [sprite, setSprite] = useState<File | null>(null)
  const [spritePreview, setSpritePreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  const loadAvatars = async () => {
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/avatars`)
      const data = await res.json()
      if (data.ok) {
        setAvatars(data.data)
      }
    } catch {
      showMessage('Failed to connect to API', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAvatars()
  }, [])

  const handleSpriteChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSprite(file)
      const reader = new FileReader()
      reader.onload = (e) => setSpritePreview(e.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      // Create avatar
      const createRes = await fetch(`${API_CONFIG.BASE_URL}/avatars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color, bio: bio.trim() || null })
      })
      
      const createData = await createRes.json()
      if (!createData.ok) {
        throw new Error(createData.detail || 'Failed to create avatar')
      }

      const avatar = createData.data

      // Upload sprite if provided
      if (sprite) {
        const formData = new FormData()
        formData.append('sprite', sprite)
        await fetch(`${API_CONFIG.BASE_URL}/avatars/${avatar.id}/sprite`, {
          method: 'POST',
          body: formData
        })
      }

      // Reset form
      setName('')
      setColor('#000000')
      setBio('')
      setSprite(null)
      setSpritePreview(null)

      showMessage(`Avatar "${avatar.name}" created!`, 'success')
      loadAvatars()
    } catch (err) {
      showMessage(err instanceof Error ? err.message : 'Failed to create avatar', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this avatar?')) return

    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/avatars/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.ok) {
        showMessage('Avatar deleted', 'success')
        loadAvatars()
      } else {
        showMessage(data.detail || 'Failed to delete', 'error')
      }
    } catch {
      showMessage('Failed to delete avatar', 'error')
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Avatar Creator</h1>

      {message && (
        <div className={`mb-6 p-4 rounded ${
          message.type === 'success' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* Create Form */}
      <div className="bg-gray-800 rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4 text-gray-400">Create New Avatar</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Enter avatar name"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-green-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Color</label>
            <div className="flex items-center gap-4">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-16 h-10 border-0 rounded cursor-pointer"
              />
              <span className="font-mono text-gray-500">{color}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Short description (optional)"
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-green-500 min-h-[80px]"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Sprite Image</label>
            <input
              type="file"
              onChange={handleSpriteChange}
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              id="sprite-input"
            />
            <label
              htmlFor="sprite-input"
              className="inline-block px-6 py-2 bg-gray-700 rounded cursor-pointer hover:bg-gray-600 transition"
            >
              Choose Image
            </label>
            {spritePreview && (
              <img
                src={spritePreview}
                alt="Preview"
                className="mt-4 max-w-[128px] max-h-[128px] rounded border-2 border-gray-600"
              />
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 bg-green-500 text-gray-900 font-semibold rounded hover:bg-green-400 transition disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating...' : 'Create Avatar'}
          </button>
        </form>
      </div>

      {/* Avatar List */}
      <div className="bg-gray-800 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-400">Existing Avatars</h2>
        
        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : avatars.length === 0 ? (
          <p className="text-gray-500">No avatars yet. Create one above!</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {avatars.map(avatar => (
              <div key={avatar.id} className="flex items-center gap-4 bg-gray-700 rounded-lg p-4">
                <div
                  className="w-16 h-16 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden"
                  style={{ backgroundColor: avatar.color }}
                >
                  {avatar.sprite_path && (
                    <img
                      src={`${API_CONFIG.BASE_URL}/${avatar.sprite_path}`}
                      alt={avatar.name}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{avatar.name}</h3>
                  <p className="text-sm text-gray-400 truncate">
                    {avatar.bio || 'No bio'}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(avatar.id)}
                  className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-500 transition"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
