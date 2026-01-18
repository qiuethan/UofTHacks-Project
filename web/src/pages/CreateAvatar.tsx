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
      <div className="h-full flex items-center justify-center p-4 relative">
        {/* Background image with dark overlay */}
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
        />
        <div className="absolute inset-0 bg-black/40" />
        
        <div className="panel-fun p-8 w-full max-w-lg relative z-10">
          <h1 className="text-3xl font-bold mb-2 text-center text-black">Create Your Avatar</h1>
          <p className="text-black text-center mb-8">
            Upload a photo and we'll generate a pixel art character for you
          </p>

          {error && (
            <div className="alert alert-error mb-6">
              {error}
            </div>
          )}

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-black mb-2">
                Your Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your name"
                className="input-fun w-full px-4 py-3 text-black placeholder-gray-400"
                maxLength={30}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-black mb-2">
                Your Photo
              </label>
              <div className="flex flex-col items-center gap-4">
                {photoPreview ? (
                  <div className="relative">
                    <img
                      src={photoPreview}
                      alt="Preview"
                      className="w-40 h-40 object-cover border-2 border-black"
                    />
                    <button
                      onClick={() => {
                        setPhoto(null)
                        setPhotoPreview(null)
                      }}
                      className="absolute -top-2 -right-2 w-8 h-8 bg-[#7a5224] flex items-center justify-center text-white hover:bg-[#7b6c00] transition"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label className="w-40 h-40 border-2 border-dashed border-black flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition">
                    <span className="text-2xl mb-2 font-bold">+</span>
                    <span className="text-sm text-black">Upload Photo</span>
                    <input
                      type="file"
                      onChange={handlePhotoChange}
                      accept="image/png,image/jpeg,image/jpg,image/webp"
                      className="hidden"
                    />
                  </label>
                )}
                <p className="text-xs text-black text-center">
                  PNG, JPG or WebP. A clear face photo works best.
                </p>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={!photo || !displayName.trim()}
              className="btn-primary w-full py-4 text-white font-bold border-0 disabled:opacity-50 disabled:transform-none disabled:shadow-none disabled:cursor-not-allowed"
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
      <div className="h-full flex items-center justify-center p-4 relative">
        {/* Background image with dark overlay */}
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
        />
        <div className="absolute inset-0 bg-black/40" />
        
        <div className="bg-[#FFF8F0] border border-black p-8 w-full max-w-lg text-center relative z-10">
          <div className="animate-spin w-16 h-16 border-4 border-black border-t-transparent mx-auto mb-6"></div>
          <h2 className="text-2xl font-bold mb-2 text-black">Creating Your Avatar</h2>
          <p className="text-black">
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
      <div className="h-full flex items-center justify-center p-4 relative">
        {/* Background image with dark overlay */}
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
        />
        <div className="absolute inset-0 bg-black/40" />
        
        <div className="panel-fun p-8 w-full max-w-lg relative z-10">
          <h2 className="text-2xl font-bold mb-2 text-center text-black">Your Avatar is Ready!</h2>
          <p className="text-black text-center mb-6">
            Here's <span className="font-semibold">{displayName}</span> in pixel art
          </p>

          {error && (
            <div className="alert alert-error mb-6">
              {error}
            </div>
          )}

          {/* Main Preview */}
          <div className="flex justify-center mb-6">
            <div className="bg-[#FFF8F0] p-4 border border-black">
              {currentSprite ? (
                <img
                  src={currentSprite}
                  alt={`${previewDirection} view`}
                  className="w-48 h-48 object-contain image-rendering-pixelated"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-black">
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
                className={`px-4 py-2 capitalize transition ${
                  previewDirection === dir
                    ? 'btn-primary text-white'
                    : 'bg-[#FFF8F0] border-3 border-black shadow-[3px_3px_0_#000] text-black hover:bg-[#bae854]'
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
                className={`p-2 cursor-pointer transition ${
                  previewDirection === dir ? 'bg-[#bae854] border-2 border-[#7a9930] shadow-[2px_2px_0_#7a9930]' : 'bg-[#FFF8F0] border-2 border-black shadow-[2px_2px_0_#000]'
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
                  <div className="w-12 h-12 bg-gray-200 flex items-center justify-center text-xs text-black">
                    ?
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-4">
            <button
              onClick={handleRegenerate}
              className="btn-secondary flex-1 py-3 text-black font-semibold"
            >
              Regenerate
            </button>
            <button
              onClick={handleSave}
              className="btn-primary flex-1 py-3 text-white font-bold border-0"
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
      <div className="h-full flex items-center justify-center p-4 relative">
        {/* Background image with dark overlay */}
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
        />
        <div className="absolute inset-0 bg-black/40" />
        
        <div className="bg-[#FFF8F0] border border-black p-8 w-full max-w-lg text-center relative z-10">
          <div className="animate-spin w-12 h-12 border-4 border-black border-t-transparent mx-auto mb-6"></div>
          <h2 className="text-xl font-bold text-black">Saving your avatar...</h2>
        </div>
      </div>
    )
  }

  // Complete Step
  if (step === 'complete') {
    return (
      <div className="h-full flex items-center justify-center p-4 relative">
        {/* Background image with dark overlay */}
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
        />
        <div className="absolute inset-0 bg-black/40" />
        
        <div className="bg-[#FFF8F0] border border-black p-8 w-full max-w-lg text-center relative z-10">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl font-bold mb-2 text-black">Avatar Created!</h2>
          <p className="text-black">Entering the Identity Matrix...</p>
        </div>
      </div>
    )
  }

  return null
}
