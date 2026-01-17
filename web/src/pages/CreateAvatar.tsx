import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { API_CONFIG } from '../config'
import { supabase } from '../lib/supabase'

type GenerationStep = 'input' | 'generating' | 'preview' | 'saving' | 'complete'

interface GeneratedSprites {
  front?: string
  back?: string
  left?: string
  right?: string
}

export default function CreateAvatar() {
  const { user, hasAvatar, onboardingCompleted, refreshAvatarStatus } = useAuth()
  const navigate = useNavigate()
  
  // If user already has avatar, redirect to appropriate next step
  useEffect(() => {
    if (hasAvatar) {
      if (onboardingCompleted) {
        navigate('/play')
      } else {
        navigate('/onboarding')
      }
    }
  }, [hasAvatar, onboardingCompleted, navigate])
  
  // Form state
  const [displayName, setDisplayName] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  
  // Generation state
  const [step, setStep] = useState<GenerationStep>('input')
  const [generatedSprites, setGeneratedSprites] = useState<GeneratedSprites | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewDirection, setPreviewDirection] = useState<'front' | 'back' | 'left' | 'right'>('front')

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhoto(file)
      const reader = new FileReader()
      reader.onload = (e) => setPhotoPreview(e.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleGenerate = async () => {
    if (!photo || !displayName.trim()) {
      setError('Please enter your name and upload a photo')
      return
    }
    
    setError(null)
    setStep('generating')

    try {
      const formData = new FormData()
      formData.append('photo', photo)

      const res = await fetch(`${API_CONFIG.BASE_URL}/generate-avatar`, {
        method: 'POST',
        body: formData
      })

      const data = await res.json()
      
      if (!res.ok || !data.ok) {
        throw new Error(data.detail || data.message || 'Failed to generate avatar')
      }

      setGeneratedSprites(data.images)
      setStep('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate avatar')
      setStep('input')
    }
  }

  const handleSave = async () => {
    if (!user || !generatedSprites) return
    
    setStep('saving')
    setError(null)

    try {
      console.log('Saving avatar for user:', user.id)
      console.log('Display name:', displayName.trim())
      console.log('Sprites:', generatedSprites)
      
      // Use the RPC function to save avatar (bypasses schema cache issues)
      const { error: rpcError } = await supabase.rpc('save_user_avatar', {
        p_user_id: user.id,
        p_display_name: displayName.trim(),
        p_sprite_front: generatedSprites.front || null,
        p_sprite_back: generatedSprites.back || null,
        p_sprite_left: generatedSprites.left || null,
        p_sprite_right: generatedSprites.right || null
      })

      if (rpcError) {
        console.error('RPC save_user_avatar failed:', rpcError)
        throw new Error(rpcError.message || 'Failed to save avatar')
      }
      
      console.log('Avatar saved successfully via RPC!')

      // Refresh auth context to know user has avatar now
      await refreshAvatarStatus()
      
      setStep('complete')
      
      // Redirect to onboarding after a short delay
      setTimeout(() => {
        navigate('/onboarding')
      }, 1500)
    } catch (err) {
      console.error('Save avatar error:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to save avatar'
      setError(errorMessage)
      setStep('preview')
    }
  }

  const handleRegenerate = () => {
    setGeneratedSprites(null)
    setStep('input')
  }

  // Input Step
  if (step === 'input') {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-lg shadow-2xl">
          <h1 className="text-3xl font-bold mb-2 text-center">Create Your Avatar</h1>
          <p className="text-gray-400 text-center mb-8">
            Upload a photo and we'll generate a pixel art character for you
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-900/50 border border-red-700 text-red-400 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Your Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 text-white placeholder-gray-500"
                maxLength={30}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Your Photo
              </label>
              <div className="flex flex-col items-center gap-4">
                {photoPreview ? (
                  <div className="relative">
                    <img
                      src={photoPreview}
                      alt="Preview"
                      className="w-40 h-40 object-cover rounded-xl border-2 border-gray-600"
                    />
                    <button
                      onClick={() => {
                        setPhoto(null)
                        setPhotoPreview(null)
                      }}
                      className="absolute -top-2 -right-2 w-8 h-8 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-400 transition"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label className="w-40 h-40 border-2 border-dashed border-gray-600 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-green-500 hover:bg-gray-700/50 transition">
                    <span className="text-4xl mb-2">📷</span>
                    <span className="text-sm text-gray-400">Upload Photo</span>
                    <input
                      type="file"
                      onChange={handlePhotoChange}
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      className="hidden"
                    />
                  </label>
                )}
                <p className="text-xs text-gray-500 text-center">
                  PNG, JPG or WebP. A clear face photo works best.
                </p>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={!photo || !displayName.trim()}
              className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-lg hover:from-green-400 hover:to-emerald-500 transition disabled:from-gray-600 disabled:to-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed shadow-lg"
            >
              Generate Avatar
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Generating Step
  if (step === 'generating') {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-lg shadow-2xl text-center">
          <div className="animate-spin w-16 h-16 border-4 border-green-500 border-t-transparent rounded-full mx-auto mb-6"></div>
          <h2 className="text-2xl font-bold mb-2">Creating Your Avatar</h2>
          <p className="text-gray-400">
            This may take a minute... AI is working its magic
          </p>
        </div>
      </div>
    )
  }

  // Preview Step
  if (step === 'preview' && generatedSprites) {
    const currentSprite = generatedSprites[previewDirection]
    const directions: Array<'front' | 'back' | 'left' | 'right'> = ['front', 'back', 'left', 'right']
    
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-lg shadow-2xl">
          <h2 className="text-2xl font-bold mb-2 text-center">Your Avatar is Ready!</h2>
          <p className="text-gray-400 text-center mb-6">
            Here's <span className="text-green-400 font-semibold">{displayName}</span> in pixel art
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-900/50 border border-red-700 text-red-400 rounded-lg">
              {error}
            </div>
          )}

          {/* Main Preview */}
          <div className="flex justify-center mb-6">
            <div className="bg-gray-900 rounded-xl p-4 border border-gray-700">
              {currentSprite ? (
                <img
                  src={currentSprite}
                  alt={`${previewDirection} view`}
                  className="w-48 h-48 object-contain image-rendering-pixelated"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-gray-500">
                  No image
                </div>
              )}
            </div>
          </div>

          {/* Direction Selector */}
          <div className="flex justify-center gap-2 mb-8">
            {directions.map(dir => (
              <button
                key={dir}
                onClick={() => setPreviewDirection(dir)}
                className={`px-4 py-2 rounded-lg capitalize transition ${
                  previewDirection === dir
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {dir}
              </button>
            ))}
          </div>

          {/* All Sprites Preview */}
          <div className="flex justify-center gap-4 mb-8">
            {directions.map(dir => (
              <div
                key={dir}
                className={`p-2 rounded-lg cursor-pointer transition ${
                  previewDirection === dir ? 'bg-green-500/20 ring-2 ring-green-500' : 'bg-gray-700'
                }`}
                onClick={() => setPreviewDirection(dir)}
              >
                {generatedSprites[dir] ? (
                  <img
                    src={generatedSprites[dir]}
                    alt={dir}
                    className="w-12 h-12 object-contain"
                    style={{ imageRendering: 'pixelated' }}
                  />
                ) : (
                  <div className="w-12 h-12 bg-gray-600 rounded flex items-center justify-center text-xs text-gray-400">
                    ?
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-4">
            <button
              onClick={handleRegenerate}
              className="flex-1 py-3 bg-gray-700 text-white font-semibold rounded-lg hover:bg-gray-600 transition"
            >
              Regenerate
            </button>
            <button
              onClick={handleSave}
              className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-lg hover:from-green-400 hover:to-emerald-500 transition shadow-lg"
            >
              Use This Avatar
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Saving Step
  if (step === 'saving') {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-lg shadow-2xl text-center">
          <div className="animate-spin w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full mx-auto mb-6"></div>
          <h2 className="text-xl font-bold">Saving your avatar...</h2>
        </div>
      </div>
    )
  }

  // Complete Step
  if (step === 'complete') {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-lg shadow-2xl text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold mb-2">Avatar Created!</h2>
          <p className="text-gray-400">Entering the world...</p>
        </div>
      </div>
    )
  }

  return null
}
