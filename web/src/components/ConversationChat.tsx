import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '../types/game'
import { API_CONFIG } from '../config'

interface RelationshipStats {
  sentiment: number
  familiarity: number
  interaction_count: number
  is_new: boolean
  last_interaction: string | null
}


interface ConversationChatProps {
  messages: ChatMessage[]
  partnerName: string
  partnerSpriteUrl?: string
  myEntityId: string | null
  partnerId: string | null
  isWaitingForResponse: boolean
  onSendMessage: (content: string) => void
  onEndConversation: () => void
}

export function ConversationChat({
  messages,
  partnerName,
  partnerSpriteUrl,
  myEntityId,
  partnerId,
  isWaitingForResponse,
  onSendMessage,
  onEndConversation
}: ConversationChatProps) {
  const [inputValue, setInputValue] = useState('')
  const [relationshipStats, setRelationshipStats] = useState<RelationshipStats | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch relationship stats when conversation starts or after each message
  useEffect(() => {
    if (myEntityId && partnerId) {
      fetch(`${API_CONFIG.BASE_URL}/relationship/${myEntityId}/${partnerId}`)
        .then(res => res.json())
        .then(data => {
          if (data.ok) {
            setRelationshipStats({
              sentiment: data.sentiment,
              familiarity: data.familiarity,
              interaction_count: data.interaction_count,
              is_new: data.is_new,
              last_interaction: data.last_interaction
            })
          }
        })
        .catch(err => console.error('Error fetching relationship:', err))
    }
  }, [myEntityId, partnerId, messages.length])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  
  // Helper to get sentiment label and color
  const getSentimentInfo = (sentiment: number) => {
    if (sentiment >= 0.7) return { label: 'Loves you', color: 'text-[#007a28]', emoji: '💚' }
    if (sentiment >= 0.6) return { label: 'Likes you', color: 'text-[#00a938]', emoji: '😊' }
    if (sentiment >= 0.45) return { label: 'Neutral', color: 'text-black/60', emoji: '😐' }
    if (sentiment >= 0.3) return { label: 'Dislikes', color: 'text-[#7a5224]', emoji: '😒' }
    return { label: 'Hates you', color: 'text-red-600', emoji: '😠' }
  }
  
  // Helper to get familiarity label
  const getFamiliarityInfo = (familiarity: number) => {
    if (familiarity >= 0.8) return { label: 'Best friends', color: 'text-[#007a28]' }
    if (familiarity >= 0.6) return { label: 'Good friends', color: 'text-[#00a938]' }
    if (familiarity >= 0.4) return { label: 'Acquaintances', color: 'text-[#7a5224]' }
    if (familiarity >= 0.2) return { label: 'Just met', color: 'text-black/60' }
    return { label: 'Strangers', color: 'text-black/40' }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim() && !isWaitingForResponse) {
      onSendMessage(inputValue.trim())
      setInputValue('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Prevent game movement keys from bubbling (WASD, arrows, etc.)
    e.stopPropagation()
    // Let Enter key trigger form submission naturally via onSubmit
  }

  return (
    <>
      {/* Partner sprite - large, positioned BEHIND the modal */}
      {partnerSpriteUrl && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
          <img 
            src={partnerSpriteUrl} 
            alt={partnerName}
            className="object-contain"
            style={{ 
              imageRendering: 'pixelated',
              width: '400px',
              height: '800px'
            }}
          />
        </div>
      )}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
        <div className="bg-[#FFF8F0] border-2 border-black shadow-[4px_4px_0_#000] overflow-hidden relative">
        {/* Header */}
        <div className="px-4 py-3 border-b-2 border-black bg-[#FFF8F0]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-[#007a28] animate-pulse"></div>
              <span className="text-black font-medium">Chatting with {partnerName}</span>
            </div>
            <button
              onClick={onEndConversation}
              className="px-3 py-1 text-sm text-black hover:underline transition-colors"
            >
              End
            </button>
          </div>
          
          {/* Relationship Stats Bar */}
          {relationshipStats && (
            <div className="flex items-center gap-4 text-xs">
              {/* Sentiment */}
              <div className="flex items-center gap-1.5">
                <span className="text-black/60">Sentiment:</span>
                <span className={getSentimentInfo(relationshipStats.sentiment).color.replace('text-', 'text-')}>
                  {getSentimentInfo(relationshipStats.sentiment).emoji} {getSentimentInfo(relationshipStats.sentiment).label}
                </span>
                <span className="text-black/40 font-mono">
                  ({(relationshipStats.sentiment * 100).toFixed(0)}%)
                </span>
              </div>
              
              {/* Familiarity */}
              <div className="flex items-center gap-1.5">
                <span className="text-black/60">Familiarity:</span>
                <span className={getFamiliarityInfo(relationshipStats.familiarity).color.replace('text-', 'text-')}>
                  {getFamiliarityInfo(relationshipStats.familiarity).label}
                </span>
                <span className="text-black/40 font-mono">
                  ({(relationshipStats.familiarity * 100).toFixed(0)}%)
                </span>
              </div>
              
              {/* Interaction Count */}
              <div className="flex items-center gap-1.5">
                <span className="text-black/60">Chats:</span>
                <span className="text-[#007a28] font-medium">{relationshipStats.interaction_count}</span>
              </div>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="h-64 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center text-black text-sm py-8">
              Say hello to start the conversation!
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.senderId === myEntityId
              return (
                <div
                  key={msg.id}
                  className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] px-4 py-2 ${
                      isMe
                        ? 'bg-[#007a28] text-white border-2 border-[#005018]'
                        : 'bg-[#FFF8F0] text-black border-2 border-black'
                    }`}
                  >
                    {!isMe && (
                      <div className="text-xs text-black mb-1">{msg.senderName}</div>
                    )}
                    <div className="text-sm break-words">{msg.content}</div>
                  </div>
                </div>
              )
            })
          )}
          
          {/* Typing indicator */}
          {isWaitingForResponse && (
            <div className="flex justify-start">
              <div className="bg-[#FFF8F0] text-black px-4 py-2 border-2 border-black">
                <div className="flex gap-1 items-center">
                  <span className="text-xs text-black">{partnerName} is typing</span>
                  <span className="flex gap-0.5">
                    <span className="w-1.5 h-1.5 bg-black animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-black animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-black animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-3 border-t-2 border-black bg-[#FFF8F0]">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={isWaitingForResponse}
              className="input-fun flex-1 px-4 py-2 text-black placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isWaitingForResponse}
              className="btn-primary px-4 py-2 text-white font-medium border-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            >
              Send
            </button>
          </div>
        </form>
        </div>
      </div>
    </>
  )
}
