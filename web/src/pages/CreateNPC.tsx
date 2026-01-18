import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_CONFIG } from '../config'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface GeneratedSprites {
  front?: string
  back?: string
  left?: string
  right?: string
}

/**
 * NPC Creation Page - Secret route at /create
 * Creates LLM-controlled characters without requiring login.
 * These NPCs will be automated by the AI system and cannot be played by humans.
 */
export default function CreateNPC() {
  const navigate = useNavigate()
  
  // NPC state
  const [npcId, setNpcId] = useState<string | null>(null)
  
  // Display name state
  const [displayName, setDisplayName] = useState('')
  
  // Avatar generation state
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedSprites, setGeneratedSprites] = useState<GeneratedSprites | null>(null)
  const [previewDirection, setPreviewDirection] = useState<'front' | 'back' | 'left' | 'right'>('front')
  const [avatarError, setAvatarError] = useState<string | null>(null)
  
  // LLM chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // Completion state
  const [isCompleting, setIsCompleting] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  // Check if user can proceed
  const hasAvatar = generatedSprites !== null
  const hasLLMResponse = messages.length > 0
  const canProceed = hasAvatar && hasLLMResponse && displayName.trim().length > 0

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Photo handling
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhoto(file)
      const reader = new FileReader()
      reader.onload = (e) => setPhotoPreview(e.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  // Avatar generation
  const handleGenerate = async () => {
    if (!photo) {
      setAvatarError('Please upload a photo first')
      return
    }
    
    setAvatarError(null)
    setIsGenerating(true)

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
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Failed to generate avatar')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleRegenerate = () => {
    setGeneratedSprites(null)
    setPhoto(null)
    setPhotoPreview(null)
  }

  // Start the personality interview (creates a temporary NPC ID for chat)
  const startInterview = async () => {
    setIsLoading(true)
    
    try {
      // Create a temporary NPC for the chat session
      const tempName = displayName.trim() || 'New NPC'
      const createRes = await fetch(`${API_CONFIG.BASE_URL}/create-npc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: tempName,
          sprite_front: generatedSprites?.front,
          sprite_back: generatedSprites?.back,
          sprite_left: generatedSprites?.left,
          sprite_right: generatedSprites?.right
        })
      })
      const createData = await createRes.json()
      
      if (createData.ok && createData.npc_id) {
        setNpcId(createData.npc_id)
        
        // Notify realtime server to add NPC to world immediately
        try {
          await fetch(`${API_CONFIG.REALTIME_API_URL}/add-npc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ npc_id: createData.npc_id })
          })
        } catch (err) {
          console.warn('Could not notify realtime server:', err)
        }
        
        // Now start the chat
        const res = await fetch(`${API_CONFIG.BASE_URL}/create-npc-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            npc_id: createData.npc_id,
            message: "[START]",
            conversation_id: null
          })
        })
        
        const data = await res.json()
        if (data.ok) {
          setConversationId(data.conversation_id)
          setMessages([{ role: 'assistant', content: data.response }])
        }
      } else {
        console.error("Failed to create NPC:", createData.error)
        setAvatarError(createData.error || 'Failed to start interview')
      }
    } catch (err) {
      console.error("Interview start error:", err)
      setAvatarError(err instanceof Error ? err.message : 'Failed to start interview')
    } finally {
      setIsLoading(false)
    }
  }

  // NPC Chat (no auth required)
  const sendMessage = async (text: string) => {
    if (!text.trim() || !npcId) return

    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInputText('')
    setIsLoading(true)

    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/create-npc-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          npc_id: npcId,
          message: text,
          conversation_id: conversationId
        })
      })

      const data = await res.json()
      if (data.ok) {
        setConversationId(data.conversation_id)
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
      }
    } catch (err) {
      console.error("Chat error:", err)
    } finally {
      setIsLoading(false)
    }
  }

  // Start the chat when component mounts
  useEffect(() => {
    // Don't auto-start, let user initiate
  }, [])

  // Complete NPC creation
  const handleComplete = async () => {
    if (!generatedSprites || !displayName.trim()) return
    
    setIsCompleting(true)
    
    try {
      // Create the NPC if not already created
      let currentNpcId = npcId
      if (!currentNpcId) {
        const createRes = await fetch(`${API_CONFIG.BASE_URL}/create-npc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            display_name: displayName.trim(),
            sprite_front: generatedSprites.front,
            sprite_back: generatedSprites.back,
            sprite_left: generatedSprites.left,
            sprite_right: generatedSprites.right
          })
        })
        const createData = await createRes.json()
        if (createData.ok && createData.npc_id) {
          currentNpcId = createData.npc_id
          setNpcId(createData.npc_id)
        } else {
          throw new Error(createData.error || 'Failed to create NPC')
        }
      } else {
        // Update the existing NPC with the avatar/name
        // (The avatar might have been generated after initial creation)
        const updateRes = await fetch(`${API_CONFIG.BASE_URL}/update-npc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            npc_id: currentNpcId,
            display_name: displayName.trim(),
            sprite_front: generatedSprites.front,
            sprite_back: generatedSprites.back,
            sprite_left: generatedSprites.left,
            sprite_right: generatedSprites.right
          })
        })
        const updateData = await updateRes.json()
        if (!updateData.ok) {
          console.warn('Failed to update NPC:', updateData.error)
        }
        
        // Refresh the NPC in the realtime server to pick up new sprites
        try {
          await fetch(`${API_CONFIG.REALTIME_API_URL}/add-npc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ npc_id: currentNpcId })
          })
          console.log('NPC sprites updated in game world')
        } catch (err) {
          console.warn('Could not refresh NPC in realtime server:', err)
        }
      }

      // Complete onboarding if we had a conversation
      if (conversationId && currentNpcId) {
        await fetch(`${API_CONFIG.BASE_URL}/complete-npc-onboarding`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            npc_id: currentNpcId,
            conversation_id: conversationId
          })
        })
      }
      
      // Notify the realtime server to add the NPC to the world
      if (currentNpcId) {
        try {
          await fetch(`${API_CONFIG.REALTIME_API_URL}/add-npc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ npc_id: currentNpcId })
          })
          console.log('NPC added to game world')
        } catch (err) {
          console.warn('Could not notify realtime server (NPC will appear on server restart):', err)
        }
      }
      
      setIsComplete(true)
      
      // Redirect to watch after a short delay
      setTimeout(() => {
        navigate('/watch')
      }, 2500)
    } catch (err) {
      console.error("Completion error:", err)
      setAvatarError(err instanceof Error ? err.message : 'Failed to complete NPC creation')
      setIsCompleting(false)
    }
  }

  const directions: Array<'front' | 'back' | 'left' | 'right'> = ['front', 'back', 'left', 'right']

  // Show completion screen
  if (isComplete) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center text-black">
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
        />
        <div className="absolute inset-0 bg-black/40" />
        
        <div className="panel-fun p-12 text-center relative z-10">
          <div className="text-6xl mb-4">🤖</div>
          <h2 className="text-3xl font-bold mb-4 text-black">NPC Created!</h2>
          <p className="text-black text-lg mb-2">
            <span className="font-bold">{displayName}</span> has been added to the Identity Matrix
          </p>
          <p className="text-black/70">
            They will be controlled by AI and interact with other characters...
          </p>
          <div className="mt-6 animate-pulse text-black/50">
            Redirecting to watch mode...
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col text-black">
      {/* Background image with dark overlay */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/assets/backgrounds/lobby_background.png)' }}
      />
      <div className="absolute inset-0 bg-black/40" />
      
      {/* Header */}
      <div className="navbar-fun p-4 relative z-10">
        <div className="max-w-6xl mx-auto flex justify-between items-center relative">
          {/* Left - NPC Badge */}
          <div className="flex items-center gap-2">
            <span className="bg-purple-600 text-white px-3 py-1 text-sm font-bold rounded">
              🤖 NPC CREATOR
            </span>
          </div>
          
          {/* Center logo */}
          <div className="absolute left-1/2 -translate-x-1/2">
            <img src="/logo.png" alt="Logo" className="h-12" style={{ imageRendering: 'pixelated' }} />
          </div>
          
          {/* Right - Create button */}
          <button 
            onClick={handleComplete}
            disabled={!canProceed || isCompleting}
            className="btn-primary px-6 py-2 text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isCompleting ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent animate-spin"></div>
                <span>Creating NPC...</span>
              </>
            ) : (
              <span>Create NPC →</span>
            )}
          </button>
        </div>
      </div>

      {/* Main Content - 3 Cards */}
      <div className="flex-1 overflow-hidden p-4 relative z-10">
        <div className="max-w-6xl mx-auto h-full flex gap-4">
          
          {/* Left Column - Display Name + Avatar */}
          <div className="w-1/3 flex flex-col gap-4">
            
            {/* Display Name Card */}
            <div className="panel-fun p-6">
              <h2 className="text-lg font-bold mb-4 text-black">NPC Name</h2>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter NPC name"
                className="input-fun w-full px-4 py-3 text-black placeholder-gray-400"
                maxLength={30}
              />
              {displayName.trim() && (
                <p className="text-xs text-green-600 mt-2">✓ Name set</p>
              )}
            </div>

            {/* Avatar Generation Card */}
            <div className="panel-fun p-6 flex-1 flex flex-col overflow-hidden">
              <h2 className="text-lg font-bold mb-4 text-black">NPC Avatar</h2>
              
              {avatarError && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-3 py-2 mb-4 text-sm">
                  {avatarError}
                </div>
              )}

              {!generatedSprites ? (
                // Photo upload & generate
                <div className="flex-1 flex flex-col">
                  <div className="flex-1 flex flex-col items-center justify-center">
                    {isGenerating ? (
                      <div className="text-center">
                        <div className="animate-spin w-12 h-12 border-4 border-black border-t-transparent mx-auto mb-4"></div>
                        <p className="text-sm text-black">Generating avatar...</p>
                        <p className="text-xs text-black/60">This may take a minute</p>
                      </div>
                    ) : photoPreview ? (
                      <div className="relative">
                        <img
                          src={photoPreview}
                          alt="Preview"
                          className="w-32 h-32 object-cover border-2 border-black"
                        />
                        <button
                          onClick={() => {
                            setPhoto(null)
                            setPhotoPreview(null)
                          }}
                          className="absolute -top-2 -right-2 w-6 h-6 bg-[#7a5224] flex items-center justify-center text-white text-sm"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <label className="w-32 h-32 border-2 border-dashed border-black flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition">
                        <span className="text-xl mb-1 font-bold">+</span>
                        <span className="text-xs text-black">Upload Photo</span>
                        <input
                          type="file"
                          onChange={handlePhotoChange}
                          accept="image/png,image/jpeg,image/jpg,image/webp"
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                  
                  {photoPreview && !isGenerating && (
                    <button
                      onClick={handleGenerate}
                      className="btn-primary w-full py-3 text-white font-bold border-0 mt-4"
                    >
                      Generate Avatar
                    </button>
                  )}
                </div>
              ) : (
                // Avatar preview
                <div className="flex-1 flex flex-col">
                  <div className="flex-1 flex flex-col items-center justify-center">
                    <div className="bg-[#FFF8F0] p-2 border border-black mb-4">
                      <img
                        src={generatedSprites[previewDirection]}
                        alt={`${previewDirection} view`}
                        className="w-32 h-32 object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    </div>
                    
                    {/* Direction thumbnails */}
                    <div className="flex gap-2 mb-4">
                      {directions.map(dir => (
                        <div
                          key={dir}
                          className={`p-1 cursor-pointer transition ${
                            previewDirection === dir 
                              ? 'bg-[#bae854] border-2 border-[#7a9930]' 
                              : 'bg-[#FFF8F0] border-2 border-black'
                          }`}
                          onClick={() => setPreviewDirection(dir)}
                        >
                          <img
                            src={generatedSprites[dir]}
                            alt={dir}
                            className="w-8 h-8 object-contain"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        </div>
                      ))}
                    </div>
                    
                    <p className="text-xs text-green-600">✓ Avatar ready</p>
                  </div>
                  
                  <button
                    onClick={handleRegenerate}
                    className="btn-secondary w-full py-2 text-black text-sm mt-4"
                  >
                    Regenerate
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - LLM Chat */}
          <div className="w-2/3 panel-fun flex flex-col overflow-hidden">
            <div className="p-4 border-b-2 border-black">
              <h2 className="text-lg font-bold text-black">Define This NPC's Personality</h2>
              <p className="text-xs text-black/60">Chat to define their interests, traits, and behavior (optional)</p>
            </div>
            
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-black/50 py-8">
                  <p className="mb-4">Start a conversation to define this NPC's personality</p>
                  <button
                    onClick={startInterview}
                    disabled={isLoading}
                    className="btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {isLoading ? 'Starting...' : 'Start Personality Interview'}
                  </button>
                </div>
              )}
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] p-3 text-sm ${
                      msg.role === 'user'
                        ? 'bg-purple-600 text-white border-2 border-purple-800'
                        : 'bg-[#FFF8F0] text-black border-2 border-black'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-[#FFF8F0] p-3 border-2 border-black flex gap-2 items-center">
                    <div className="w-2 h-2 bg-black animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-black animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-black animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-4 border-t-2 border-black flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isLoading && sendMessage(inputText)}
                placeholder="Describe this NPC's personality..."
                disabled={isLoading}
                className="input-fun flex-1 px-4 py-2 disabled:opacity-50 text-black text-sm"
              />
              <button
                onClick={() => sendMessage(inputText)}
                disabled={isLoading || !inputText.trim()}
                className="btn-primary text-white w-10 h-10 flex items-center justify-center border-0 disabled:opacity-50"
              >
                ➤
              </button>
            </div>
            
            {hasLLMResponse && (
              <div className="px-4 pb-2">
                <p className="text-xs text-green-600">✓ Personality defined</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="bg-[#FFF8F0] p-3 border-t-2 border-black relative z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex gap-6 text-sm">
            <span className={displayName.trim() ? 'text-green-600' : 'text-black/40'}>
              {displayName.trim() ? '✓' : '○'} NPC Name
            </span>
            <span className={hasAvatar ? 'text-green-600' : 'text-black/40'}>
              {hasAvatar ? '✓' : '○'} Avatar Created
            </span>
            <span className={hasLLMResponse ? 'text-green-600' : 'text-black/40'}>
              {hasLLMResponse ? '✓' : '○'} Personality (optional)
            </span>
          </div>
          <p className="text-xs text-black/60">
            {canProceed ? 'Ready to create this NPC!' : 'Complete name and avatar to create NPC'}
          </p>
        </div>
      </div>
    </div>
  )
}

