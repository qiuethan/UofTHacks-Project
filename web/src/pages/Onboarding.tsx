import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { API_CONFIG } from '../config'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function Onboarding() {
  const { user, onboardingCompleted, refreshAvatarStatus, session } = useAuth()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isCompleting, setIsCompleting] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (onboardingCompleted) {
      navigate('/play')
    }
  }, [onboardingCompleted, navigate])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Initialize chat
  useEffect(() => {
    const initChat = async () => {
      if (!session?.access_token) return

      try {
        // 1. Get State
        const res = await fetch(`${API_CONFIG.BASE_URL}/onboarding/state`, {
          headers: {
            'Authorization': `Bearer ${session.access_token}`
          }
        })
        const data = await res.json()
        
        if (data.conversation_id) {
          setConversationId(data.conversation_id)
          setMessages(data.history.map((m: any) => ({
            role: m.role === 'model' ? 'assistant' : m.role, // Handle Gemini role mapping if needed, but backend saves 'assistant'
            content: m.content
          })))
        }

        // If history is empty, start conversation
        if (!data.history || data.history.length === 0) {
          await sendMessage("[START]", true)
        }
      } catch (err) {
        console.error("Failed to init chat:", err)
      }
    }

    initChat()
  }, [session])

  const sendMessage = async (text: string, isHidden: boolean = false) => {
    if (!text.trim() || !session?.access_token) return

    if (!isHidden) {
      setMessages(prev => [...prev, { role: 'user', content: text }])
    }
    
    setInputText('')
    setIsLoading(true)

    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/onboarding/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId
        })
      })

      const data = await res.json()
      setConversationId(data.conversation_id)

      if (data.status === 'completed') {
        // Handle completion
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
        await handleCompletion(data.conversation_id)
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
      }
    } catch (err) {
      console.error("Chat error:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCompletion = async (convId: string) => {
    setIsCompleting(true)
    try {
        const res = await fetch(`${API_CONFIG.BASE_URL}/onboarding/complete`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`
            },
            body: JSON.stringify({ conversation_id: convId })
        })
        
        if (res.ok) {
            await refreshAvatarStatus() // Updates user metadata in context
            setTimeout(() => {
                navigate('/play')
            }, 500)
        }
    } catch (err) {
        console.error("Completion error:", err)
        setIsCompleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#FFF8F0] text-black">
      {/* Header */}
      <div className="navbar-fun p-4">
        <div className="max-w-3xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-[#007a28] flex items-center justify-center text-xl text-white font-bold">
                    W
                </div>
                <div>
                    <h1 className="font-bold text-lg text-white">World Greeter</h1>
                    <p className="text-xs text-white/80">Setting up your profile...</p>
                </div>
            </div>
            <button 
                onClick={() => conversationId && handleCompletion(conversationId)}
                disabled={isLoading || isCompleting || !conversationId}
                className="btn-secondary px-4 py-2 text-sm text-black disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
                {isCompleting ? (
                    <>
                        <div className="w-3 h-3 border-2 border-black border-t-transparent animate-spin"></div>
                        <span>Saving...</span>
                    </>
                ) : (
                    <span>End Interview</span>
                )}
            </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="max-w-3xl mx-auto space-y-4">
            {messages.map((msg, idx) => (
            <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
                <div
                className={`max-w-[80%] p-4 ${
                    msg.role === 'user'
                    ? 'bg-[#007a28] text-white border-2 border-[#005018]'
                    : 'bg-[#FFF8F0] text-black border-2 border-black'
                }`}
                >
                {msg.content}
                </div>
            </div>
            ))}
            {isLoading && (
                <div className="flex justify-start">
                    <div className="bg-[#FFF8F0] p-4 border-2 border-black flex gap-2 items-center">
                        <div className="w-2 h-2 bg-black animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-black animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-black animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                </div>
            )}
            <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="bg-[#FFF8F0] p-4 border-t-2 border-black">
        <div className="max-w-3xl mx-auto flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && sendMessage(inputText)}
            placeholder="Type your answer..."
            disabled={isLoading}
            className="input-fun flex-1 px-6 py-3 disabled:opacity-50 text-black"
          />
          <button
            onClick={() => sendMessage(inputText)}
            disabled={isLoading || !inputText.trim()}
            className="btn-primary text-white w-12 h-12 flex items-center justify-center border-0 disabled:opacity-50"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}
