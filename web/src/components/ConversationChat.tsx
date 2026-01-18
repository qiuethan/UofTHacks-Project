import { useState, useRef, useEffect } from 'react'
import type { ChatMessage } from '../types/game'

interface RelationshipStats {
  sentiment: number
  familiarity: number
  interaction_count: number
  is_new: boolean
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
      fetch(`http://localhost:8000/relationship/${myEntityId}/${partnerId}`)
        .then(res => res.json())
        .then(data => {
          if (data.ok) {
            setRelationshipStats({
              sentiment: data.sentiment,
              familiarity: data.familiarity,
              interaction_count: data.interaction_count,
              is_new: data.is_new
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
    if (sentiment >= 0.7) return { label: 'Loves you', color: 'text-green-400', emoji: '💚' }
    if (sentiment >= 0.6) return { label: 'Likes you', color: 'text-green-300', emoji: '😊' }
    if (sentiment >= 0.45) return { label: 'Neutral', color: 'text-gray-400', emoji: '😐' }
    if (sentiment >= 0.3) return { label: 'Dislikes', color: 'text-orange-400', emoji: '😒' }
    return { label: 'Hates you', color: 'text-red-400', emoji: '😠' }
  }
  
  // Helper to get familiarity label
  const getFamiliarityInfo = (familiarity: number) => {
    if (familiarity >= 0.8) return { label: 'Best friends', color: 'text-purple-400' }
    if (familiarity >= 0.6) return { label: 'Good friends', color: 'text-blue-400' }
    if (familiarity >= 0.4) return { label: 'Acquaintances', color: 'text-cyan-400' }
    if (familiarity >= 0.2) return { label: 'Just met', color: 'text-gray-400' }
    return { label: 'Strangers', color: 'text-gray-500' }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim() && !isWaitingForResponse) {
      onSendMessage(inputValue.trim())
      setInputValue('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Prevent game movement keys from bubbling
    e.stopPropagation()
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
        <div className="bg-gray-900/95 backdrop-blur-md rounded-2xl shadow-2xl border border-gray-700/50 overflow-hidden relative">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-700/50 bg-gray-800/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-white font-medium">Chatting with {partnerName}</span>
            </div>
            <button
              onClick={onEndConversation}
              className="px-3 py-1 text-sm text-gray-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
            >
              End
            </button>
          </div>
          
          {/* Relationship Stats Bar */}
          {relationshipStats && (
            <div className="flex items-center gap-4 text-xs">
              {/* Sentiment */}
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">Sentiment:</span>
                <span className={getSentimentInfo(relationshipStats.sentiment).color}>
                  {getSentimentInfo(relationshipStats.sentiment).emoji} {getSentimentInfo(relationshipStats.sentiment).label}
                </span>
                <span className="text-gray-600">({(relationshipStats.sentiment * 100).toFixed(0)}%)</span>
              </div>
              
              {/* Familiarity */}
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">Familiarity:</span>
                <span className={getFamiliarityInfo(relationshipStats.familiarity).color}>
                  {getFamiliarityInfo(relationshipStats.familiarity).label}
                </span>
                <span className="text-gray-600">({(relationshipStats.familiarity * 100).toFixed(0)}%)</span>
              </div>
              
              {/* Interaction Count */}
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">Chats:</span>
                <span className="text-blue-400">{relationshipStats.interaction_count}</span>
              </div>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="h-64 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">
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
                    className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                      isMe
                        ? 'bg-blue-600 text-white rounded-br-md'
                        : 'bg-gray-700 text-gray-100 rounded-bl-md'
                    }`}
                  >
                    {!isMe && (
                      <div className="text-xs text-gray-400 mb-1">{msg.senderName}</div>
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
              <div className="bg-gray-700 text-gray-400 px-4 py-2 rounded-2xl rounded-bl-md">
                <div className="flex gap-1 items-center">
                  <span className="text-xs">{partnerName} is typing</span>
                  <span className="flex gap-0.5">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="p-3 border-t border-gray-700/50 bg-gray-800/30">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={isWaitingForResponse}
              className="flex-1 px-4 py-2 bg-gray-800 border border-gray-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isWaitingForResponse}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
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
