import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { API_CONFIG } from '../config'
import { supabase } from '../lib/supabase'

interface UserProfile {
  display_name: string | null
  sprite_front: string | null
  sprite_back: string | null
  sprite_left: string | null
  sprite_right: string | null
  has_avatar: boolean
}

type PreviewDirection = 'front' | 'back' | 'left' | 'right'

export default function Profile() {
  const { user, refreshAvatarStatus } = useAuth()
  const navigate = useNavigate()
  
  // Profile data
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // Edit state
  const [editName, setEditName] = useState('')
  const [isEditingName, setIsEditingName] = useState(false)
  
  // Regeneration state
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [newPhoto, setNewPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [regeneratedSprites, setRegeneratedSprites] = useState<Record<string, string> | null>(null)
  
  // Preview
  const [previewDirection, setPreviewDirection] = useState<PreviewDirection>('front')

  // Load profile data
  useEffect(() => {
    if (user) {
      loadProfile()
    }
  }, [user])

  const loadProfile = async () => {
    if (!user) return
    
    setLoading(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_positions?user_id=eq.${user.id}&select=display_name,sprite_front,sprite_back,sprite_left,sprite_right,has_avatar`,
        {
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${sessionData.session?.access_token}`
          }
        }
      )
      
      if (response.ok) {
        const data = await response.json()
        if (data && data.length > 0) {
          setProfile(data[0])
          setEditName(data[0].display_name || '')
        }
      }
    } catch (err) {
      console.error('Failed to load profile:', err)
      setError('Failed to load profile')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveName = async () => {
    if (!user || !editName.trim()) return
    
    setSaving(true)
    setError(null)
    
    try {
      const { error: rpcError } = await supabase.rpc('save_user_avatar', {
        p_user_id: user.id,
        p_display_name: editName.trim(),
        p_sprite_front: profile?.sprite_front || null,
        p_sprite_back: profile?.sprite_back || null,
        p_sprite_left: profile?.sprite_left || null,
        p_sprite_right: profile?.sprite_right || null
      })

      if (rpcError) throw new Error(rpcError.message)
      
      setProfile(prev => prev ? { ...prev, display_name: editName.trim() } : null)
      setIsEditingName(false)
      setSuccess('Name updated!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update name')
    } finally {
      setSaving(false)
    }
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setNewPhoto(file)
      const reader = new FileReader()
      reader.onload = (e) => setPhotoPreview(e.target?.result as string)
      reader.readAsDataURL(file)
      setRegeneratedSprites(null)
    }
  }

  const handleRegenerate = async () => {
    if (!newPhoto || !user) return
    
    setIsRegenerating(true)
    setError(null)
    
    try {
      const formData = new FormData()
      formData.append('photo', newPhoto)

      const res = await fetch(`${API_CONFIG.BASE_URL}/generate-avatar`, {
        method: 'POST',
        body: formData
      })

      const data = await res.json()
      
      if (!res.ok || !data.ok) {
        throw new Error(data.detail || data.message || 'Failed to generate avatar')
      }

      setRegeneratedSprites(data.images)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate avatar')
    } finally {
      setIsRegenerating(false)
    }
  }

  const handleSaveNewSprites = async () => {
    if (!user || !regeneratedSprites) return
    
    setSaving(true)
    setError(null)
    
    try {
      const { error: rpcError } = await supabase.rpc('save_user_avatar', {
        p_user_id: user.id,
        p_display_name: profile?.display_name || editName.trim(),
        p_sprite_front: regeneratedSprites.front || null,
        p_sprite_back: regeneratedSprites.back || null,
        p_sprite_left: regeneratedSprites.left || null,
        p_sprite_right: regeneratedSprites.right || null
      })

      if (rpcError) throw new Error(rpcError.message)
      
      // Update local profile with new sprites
      setProfile(prev => prev ? {
        ...prev,
        sprite_front: regeneratedSprites.front || null,
        sprite_back: regeneratedSprites.back || null,
        sprite_left: regeneratedSprites.left || null,
        sprite_right: regeneratedSprites.right || null,
        has_avatar: true
      } : null)
      
      // Reset regeneration state
      setNewPhoto(null)
      setPhotoPreview(null)
      setRegeneratedSprites(null)
      
      await refreshAvatarStatus()
      setSuccess('Avatar updated!')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save new avatar')
    } finally {
      setSaving(false)
    }
  }

  const cancelRegeneration = () => {
    setNewPhoto(null)
    setPhotoPreview(null)
    setRegeneratedSprites(null)
  }

  const getCurrentSprite = () => {
    const sprites = regeneratedSprites || profile
    if (!sprites) return null
    
    switch (previewDirection) {
      case 'front': return sprites.sprite_front
      case 'back': return sprites.sprite_back
      case 'left': return sprites.sprite_left
      case 'right': return sprites.sprite_right
      default: return sprites.sprite_front
    }
  }

  const directions: PreviewDirection[] = ['front', 'back', 'left', 'right']

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-black">Loading profile...</div>
      </div>
    )
  }

  if (!profile?.has_avatar) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="panel-fun p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4 text-black">No Avatar Yet</h2>
          <p className="text-black mb-6">You haven't created an avatar yet. Create one to start playing!</p>
          <button
            onClick={() => navigate('/create')}
            className="btn-primary px-6 py-3 text-white font-bold border-0"
          >
            Create Avatar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full p-4">
      <div className="max-w-2xl mx-auto">
        {error && (
          <div className="alert alert-error mb-6">
            {error}
          </div>
        )}

        {success && (
          <div className="alert alert-success mb-6">
            {success}
          </div>
        )}

        {/* Display Name Section */}
        <div className="panel-fun p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-black">Display Name</h2>
          
          {isEditingName ? (
            <div className="flex gap-3">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="input-fun flex-1 px-4 py-2 text-black"
                maxLength={30}
              />
              <button
                onClick={handleSaveName}
                disabled={saving || !editName.trim()}
                className="btn-primary px-4 py-2 text-white border-0 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setIsEditingName(false)
                  setEditName(profile?.display_name || '')
                }}
                className="btn-danger px-4 py-2 text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-xl text-black">{profile?.display_name || 'No name set'}</span>
              <button
                onClick={() => setIsEditingName(true)}
                className="btn-secondary px-4 py-2 text-black"
              >
                Edit
              </button>
            </div>
          )}
        </div>

        {/* Avatar Preview Section */}
        <div className="panel-fun p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-black">Your Avatar</h2>
          
          {/* Main Preview */}
          <div className="flex justify-center mb-6">
            <div className="bg-[#FFF8F0] p-4 border border-black">
              {getCurrentSprite() ? (
                <img
                  src={getCurrentSprite()!}
                  alt={`${previewDirection} view`}
                  className="w-48 h-48 object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-black">
                  No sprite
                </div>
              )}
            </div>
          </div>

          {/* Direction Selector */}
          <div className="flex justify-center gap-2 mb-4">
            {directions.map(dir => (
              <button
                key={dir}
                onClick={() => setPreviewDirection(dir)}
                className={`px-4 py-2 capitalize transition rounded border-[3px] border-black ${
                  previewDirection === dir
                    ? 'btn-primary btn-active text-white'
                    : 'bg-[#FFF8F0] shadow-[3px_3px_0_#000] text-black hover:bg-[#bae854]'
                }`}
              >
                {dir}
              </button>
            ))}
          </div>

          {/* All Sprites Preview */}
          <div className="flex justify-center gap-4">
            {directions.map(dir => {
              const sprites = regeneratedSprites || profile
              const spriteUrl = sprites?.[`sprite_${dir}` as keyof typeof sprites] as string | null
              return (
                <div
                  key={dir}
                  className={`p-2 cursor-pointer transition ${
                    previewDirection === dir ? 'bg-[#bae854] border-2 border-[#7a9930] shadow-[2px_2px_0_#7a9930]' : 'bg-[#FFF8F0] border-2 border-black shadow-[2px_2px_0_#000]'
                  }`}
                  onClick={() => setPreviewDirection(dir)}
                >
                  {spriteUrl ? (
                    <img
                      src={spriteUrl}
                      alt={dir}
                      className="w-12 h-12 object-contain"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  ) : (
                    <div className="w-12 h-12 bg-gray-200 flex items-center justify-center text-xs text-black">
                      ?
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Regenerate Avatar Section */}
        <div className="panel-fun p-6">
          <h2 className="text-xl font-semibold mb-4 text-black">Regenerate Avatar</h2>
          <p className="text-black text-sm mb-4">
            Upload a new photo to generate a new avatar. This will replace your current sprites.
          </p>

          {!regeneratedSprites ? (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-4">
                {photoPreview ? (
                  <div className="relative">
                    <img
                      src={photoPreview}
                      alt="New photo"
                      className="w-24 h-24 object-cover border-2 border-black"
                    />
                    <button
                      onClick={() => {
                        setNewPhoto(null)
                        setPhotoPreview(null)
                      }}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-[#7a5224] flex items-center justify-center text-white text-sm hover:bg-[#7b6c00]"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label className="w-24 h-24 border-2 border-dashed border-black flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition">
                    <span className="text-2xl mb-1 font-bold">+</span>
                    <span className="text-xs text-black">Upload</span>
                    <input
                      type="file"
                      onChange={handlePhotoChange}
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      className="hidden"
                    />
                  </label>
                )}
                
                <button
                  onClick={handleRegenerate}
                  disabled={!newPhoto || isRegenerating}
                  className="btn-primary px-6 py-3 text-white font-bold disabled:opacity-50 disabled:transform-none disabled:shadow-none"
                >
                  {isRegenerating ? 'Generating...' : 'Generate New Avatar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-black font-medium">New avatar generated! Review and save:</p>
              
              <div className="flex justify-center gap-4">
                {directions.map(dir => {
                  const spriteUrl = regeneratedSprites[dir]
                  return (
                    <div key={dir} className="p-2 bg-white border border-black">
                      {spriteUrl ? (
                        <img
                          src={spriteUrl}
                          alt={dir}
                          className="w-16 h-16 object-contain"
                          style={{ imageRendering: 'pixelated' }}
                        />
                      ) : (
                        <div className="w-16 h-16 bg-gray-200" />
                      )}
                      <p className="text-xs text-center text-black mt-1 capitalize">{dir}</p>
                    </div>
                  )
                })}
              </div>
              
              <div className="flex gap-4 justify-center">
                <button
                  onClick={cancelRegeneration}
                  className="btn-danger px-6 py-2 text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveNewSprites}
                  disabled={saving}
                  className="btn-primary px-6 py-2 text-white font-bold border-0 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Use This Avatar'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Play Button */}
        <div className="mt-8 pb-16 text-center">
          <button
            onClick={() => navigate('/play')}
            className="btn-primary px-8 py-4 text-white font-bold text-lg border-0"
          >
            Enter the World
          </button>
        </div>
      </div>
    </div>
  )
}
