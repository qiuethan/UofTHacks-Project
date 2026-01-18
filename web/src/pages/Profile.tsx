import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { API_CONFIG } from '../config'
import { supabase } from '../lib/supabase'
import { Users, MessageCircle, User, Heart, Meh, Frown, Star, ThumbsUp, X, RefreshCw } from 'lucide-react'

interface UserProfile {
  display_name: string | null
  sprite_front: string | null
  sprite_back: string | null
  sprite_left: string | null
  sprite_right: string | null
  has_avatar: boolean
}

interface Relationship {
  partner_id: string
  partner_name: string
  partner_sprite: string | null
  sentiment: number
  familiarity: number
  interaction_count: number
  last_interaction: string | null
  last_topic: string | null
  mutual_interests: string[]
  conversation_summary: string | null
  relationship_notes: string | null
}

interface Conversation {
  id: string
  partner_id: string
  partner_name: string
  partner_sprite: string | null
  created_at: string
  ended_at: string | null
  message_count: number
  summary: string | null
  score: number | null
  transcript: Array<{
    senderId: string
    senderName: string
    content: string
    timestamp: number
  }>
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
  
  // Relationships and conversations
  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loadingRelationships, setLoadingRelationships] = useState(false)
  const [selectedRelationship, setSelectedRelationship] = useState<Relationship | null>(null)
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [activeTab, setActiveTab] = useState<'relationships' | 'conversations'>('relationships')

  // Load profile data
  useEffect(() => {
    if (user) {
      loadProfile()
      loadRelationships()
      loadConversations()
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
          console.log('[Profile] Loaded profile data:', {
            hasSpriteFront: !!data[0].sprite_front,
            hasSpriteBack: !!data[0].sprite_back,
            hasSpriteLeft: !!data[0].sprite_left,
            hasSpriteRight: !!data[0].sprite_right,
            frontUrl: data[0].sprite_front?.substring(0, 50) + '...'
          })
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
  
  const loadRelationships = async () => {
    if (!user) return
    
    setLoadingRelationships(true)
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/user/${user.id}/relationships`)
      const data = await response.json()
      if (data.ok) {
        setRelationships(data.data || [])
      }
    } catch (err) {
      console.error('Failed to load relationships:', err)
    } finally {
      setLoadingRelationships(false)
    }
  }
  
  const loadConversations = async () => {
    if (!user) return
    
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/user/${user.id}/conversations`)
      const data = await response.json()
      if (data.ok) {
        setConversations(data.data || [])
      }
    } catch (err) {
      console.error('Failed to load conversations:', err)
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

  // Add cache-busting timestamp to prevent stale images
  const addCacheBuster = (url: string | null | undefined): string | null => {
    if (!url) return null
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}t=${Date.now()}`
  }

  const getCurrentSprite = () => {
    // For regenerated sprites, use the new URLs directly (they're fresh)
    if (regeneratedSprites) {
      switch (previewDirection) {
        case 'front': return regeneratedSprites.front
        case 'back': return regeneratedSprites.back
        case 'left': return regeneratedSprites.left
        case 'right': return regeneratedSprites.right
        default: return regeneratedSprites.front
      }
    }
    
    // For profile sprites, add cache buster to ensure fresh images
    if (!profile) return null
    
    switch (previewDirection) {
      case 'front': return addCacheBuster(profile.sprite_front)
      case 'back': return addCacheBuster(profile.sprite_back)
      case 'left': return addCacheBuster(profile.sprite_left)
      case 'right': return addCacheBuster(profile.sprite_right)
      default: return addCacheBuster(profile.sprite_front)
    }
  }

  const directions: PreviewDirection[] = ['front', 'back', 'left', 'right']

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center relative">
        {/* Fixed background */}
        <div 
          className="fixed inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
        />
        <div className="fixed inset-0 bg-black/40" />
        <div className="text-white relative z-10">Loading profile...</div>
      </div>
    )
  }

  if (!profile?.has_avatar) {
    return (
      <div className="h-full flex items-center justify-center p-4 relative">
        {/* Fixed background */}
        <div 
          className="fixed inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
        />
        <div className="fixed inset-0 bg-black/40" />
        <div className="panel-fun p-8 text-center max-w-md relative z-10">
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
    <div className="h-full relative">
      {/* Fixed background */}
      <div 
        className="fixed inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
      />
      <div className="fixed inset-0 bg-black/40" />
      
      {/* Scrollable content */}
      <div className="relative z-10 h-full overflow-y-auto p-4">
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-black">Your Avatar</h2>
            <button
              onClick={() => loadProfile()}
              className="p-2 text-black/60 hover:text-black transition-colors"
              title="Refresh sprites"
            >
              <RefreshCw size={18} />
            </button>
          </div>
          
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
              // Get the correct sprite URL based on whether we have regenerated sprites or not
              let spriteUrl: string | null = null
              if (regeneratedSprites) {
                spriteUrl = regeneratedSprites[dir] || null
              } else if (profile) {
                const rawUrl = profile[`sprite_${dir}` as keyof typeof profile] as string | null
                spriteUrl = addCacheBuster(rawUrl)
              }
              
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
                      className="absolute -top-2 -right-2 w-6 h-6 bg-[#7a5224] flex items-center justify-center text-white hover:bg-[#7b6c00]"
                    >
                      <X size={14} />
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
                    <div key={dir} className="p-2 bg-[#FFF8F0] border border-black">
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

        {/* Relationships & Conversations Section */}
        <div className="panel-fun p-6 mb-6">
          <h2 className="text-xl font-bold mb-4 text-black">Your Connections</h2>
          
          {/* Tab Switcher */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('relationships')}
              className={`px-4 py-2 font-medium transition border-2 border-black flex items-center gap-2 ${
                activeTab === 'relationships' 
                  ? 'btn-primary text-white' 
                  : 'bg-white text-black hover:bg-gray-100'
              }`}
            >
              <Users size={18} /> People ({relationships.length})
            </button>
            <button
              onClick={() => setActiveTab('conversations')}
              className={`px-4 py-2 font-medium transition border-2 border-black flex items-center gap-2 ${
                activeTab === 'conversations' 
                  ? 'btn-primary text-white' 
                  : 'bg-white text-black hover:bg-gray-100'
              }`}
            >
              <MessageCircle size={18} /> Conversations ({conversations.length})
            </button>
          </div>
          
          {/* Relationships Tab */}
          {activeTab === 'relationships' && (
            <div className="space-y-3">
              {loadingRelationships ? (
                <div className="text-center text-black/60 py-8">Loading relationships...</div>
              ) : relationships.length === 0 ? (
                <div className="text-center text-black/60 py-8">
                  <p className="text-lg mb-2">No connections yet</p>
                  <p className="text-sm">Start conversations with others to build relationships!</p>
                </div>
              ) : (
                relationships.map(rel => (
                  <div 
                    key={rel.partner_id}
                    onClick={() => setSelectedRelationship(selectedRelationship?.partner_id === rel.partner_id ? null : rel)}
                    className={`bg-white border-2 p-4 cursor-pointer transition hover:shadow-md ${
                      selectedRelationship?.partner_id === rel.partner_id 
                        ? 'border-[#007a28] shadow-[3px_3px_0_#007a28]' 
                        : 'border-black'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Partner Avatar */}
                      <div className="w-14 h-14 bg-[#FFF8F0] border-2 border-black overflow-hidden flex-shrink-0">
                        {rel.partner_sprite ? (
                          <img 
                            src={rel.partner_sprite} 
                            alt={rel.partner_name}
                            className="w-full h-full object-contain"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-black">
                            <User size={32} />
                          </div>
                        )}
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-black truncate">{rel.partner_name}</div>
                        <div className="text-sm text-black/60">
                          {rel.interaction_count} conversation{rel.interaction_count !== 1 ? 's' : ''}
                        </div>
                      </div>
                      
                      {/* Sentiment Indicator */}
                      <div className="flex flex-col items-center gap-1">
                        <span className={`${
                          rel.sentiment > 0.7 ? 'text-[#007a28]' : 
                          rel.sentiment > 0.3 ? 'text-[#00a938]' : 
                          rel.sentiment > -0.3 ? 'text-black/60' : 'text-red-600'
                        }`}>
                          {rel.sentiment > 0.7 ? <Heart size={24} fill="currentColor" /> : 
                           rel.sentiment > 0.3 ? <Heart size={24} /> : 
                           rel.sentiment > -0.3 ? <Meh size={24} /> : <Frown size={24} />}
                        </span>
                        <span className={`text-xs font-medium ${
                          rel.sentiment > 0.5 ? 'text-[#007a28]' : 
                          rel.sentiment > 0 ? 'text-black/60' : 'text-red-600'
                        }`}>
                          {rel.sentiment > 0.7 ? 'Great' : rel.sentiment > 0.3 ? 'Good' : rel.sentiment > -0.3 ? 'Neutral' : 'Poor'}
                        </span>
                      </div>
                    </div>
                    
                    {/* Expanded Details */}
                    {selectedRelationship?.partner_id === rel.partner_id && (
                      <div className="mt-4 pt-4 border-t-2 border-black/20 space-y-3">
                        {/* Stats */}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-black/60 font-medium">Familiarity</span>
                            <div className="mt-1 bg-gray-200 border border-black h-3 overflow-hidden">
                              <div 
                                className="bg-[#7a5224] h-full transition-all"
                                style={{ width: `${rel.familiarity * 100}%` }}
                              />
                            </div>
                          </div>
                          <div>
                            <span className="text-black/60 font-medium">Sentiment</span>
                            <div className="mt-1 bg-gray-200 border border-black h-3 overflow-hidden">
                              <div 
                                className={`h-full transition-all ${rel.sentiment > 0 ? 'bg-[#007a28]' : 'bg-red-500'}`}
                                style={{ width: `${Math.abs(rel.sentiment) * 50 + 50}%` }}
                              />
                            </div>
                          </div>
                        </div>
                        
                        {/* Last Topic */}
                        {rel.last_topic && (
                          <div>
                            <span className="text-black/60 text-sm font-medium">Last talked about:</span>
                            <p className="text-black text-sm mt-1">{rel.last_topic}</p>
                          </div>
                        )}
                        
                        {/* Mutual Interests */}
                        {rel.mutual_interests && rel.mutual_interests.length > 0 && (
                          <div>
                            <span className="text-black/60 text-sm font-medium">Shared interests:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {rel.mutual_interests.slice(0, 5).map((interest, i) => (
                                <span key={i} className="px-2 py-1 bg-[#bae854] text-black text-xs font-medium border border-black">
                                  {interest}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* Relationship Notes */}
                        {rel.relationship_notes && (
                          <div>
                            <span className="text-black/60 text-sm font-medium">Relationship dynamic:</span>
                            <p className="text-black text-sm mt-1 italic">"{rel.relationship_notes}"</p>
                          </div>
                        )}
                        
                        {/* Conversation Summary */}
                        {rel.conversation_summary && (
                          <div>
                            <span className="text-black/60 text-sm font-medium">Conversation history:</span>
                            <p className="text-black text-sm mt-1 bg-white border border-black p-2 max-h-32 overflow-y-auto">
                              {rel.conversation_summary}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
          
          {/* Conversations Tab */}
          {activeTab === 'conversations' && (
            <div className="space-y-3">
              {conversations.length === 0 ? (
                <div className="text-center text-black/60 py-8">
                  <p className="text-lg mb-2">No conversations yet</p>
                  <p className="text-sm">Your chat history will appear here!</p>
                </div>
              ) : (
                conversations.map(conv => (
                  <div 
                    key={conv.id}
                    onClick={() => setSelectedConversation(selectedConversation?.id === conv.id ? null : conv)}
                    className={`bg-white border-2 p-4 cursor-pointer transition hover:shadow-md ${
                      selectedConversation?.id === conv.id 
                        ? 'border-[#7a5224] shadow-[3px_3px_0_#7a5224]' 
                        : 'border-black'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Partner Avatar */}
                      <div className="w-12 h-12 bg-[#FFF8F0] border-2 border-black overflow-hidden flex-shrink-0">
                        {conv.partner_sprite ? (
                          <img 
                            src={conv.partner_sprite} 
                            alt={conv.partner_name}
                            className="w-full h-full object-contain"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-black">
                            <User size={24} />
                          </div>
                        )}
                      </div>
                      
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-black truncate">{conv.partner_name}</div>
                        <div className="text-xs text-black/60">
                          {conv.message_count} message{conv.message_count !== 1 ? 's' : ''} • {
                            new Date(conv.created_at).toLocaleDateString()
                          }
                        </div>
                        {conv.summary && (
                          <div className="text-sm text-black/80 truncate mt-1">{conv.summary}</div>
                        )}
                      </div>
                      
                      {/* Score */}
                      {conv.score && (
                        <div className="flex flex-col items-center">
                          <span className={`${
                            conv.score >= 8 ? 'text-[#bae854]' : 
                            conv.score >= 5 ? 'text-[#007a28]' : 'text-black/60'
                          }`}>
                            {conv.score >= 8 ? <Star size={20} fill="currentColor" /> : 
                             conv.score >= 5 ? <ThumbsUp size={20} /> : <Meh size={20} />}
                          </span>
                          <span className="text-xs text-black/60 font-medium">{conv.score}/10</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Expanded Transcript */}
                    {selectedConversation?.id === conv.id && conv.transcript && conv.transcript.length > 0 && (
                      <div className="mt-4 pt-4 border-t-2 border-black/20">
                        <div className="max-h-64 overflow-y-auto space-y-2 bg-[#FFF8F0] border border-black p-2">
                          {conv.transcript.map((msg, i) => (
                            <div 
                              key={i}
                              className={`flex ${msg.senderId === user?.id ? 'justify-end' : 'justify-start'}`}
                            >
                              <div className={`max-w-[80%] px-3 py-2 text-sm border-2 ${
                                msg.senderId === user?.id 
                                  ? 'bg-[#007a28] text-white border-[#005018]' 
                                  : 'bg-white text-black border-black'
                              }`}>
                                <div className={`text-xs mb-1 ${msg.senderId === user?.id ? 'text-white/70' : 'text-black/60'}`}>
                                  {msg.senderName}
                                </div>
                                {msg.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Play Button */}
        <div className="mt-8 pb-16 text-center">
          <button
            onClick={() => navigate('/play')}
            className="btn-primary px-8 py-4 text-white font-bold text-lg border-0"
          >
            Enter the Identity Matrix
          </button>
        </div>
      </div>
      </div>
    </div>
  )
}
