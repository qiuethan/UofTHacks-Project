import { useState, useEffect, useMemo } from 'react'
import type { GameEntity } from '../game/types'

interface ActionObject {
  score: number
  action: string
  target?: {
    x: number
    y: number
    target_id?: string
    target_type?: string
  }
}

// Agent metadata fetched from API (personality, current action)
interface AgentMetadata {
  avatar_id: string
  personality: {
    sociability: number
    curiosity: number
    agreeableness: number
  }
  current_action: string | ActionObject
  last_action_time: string | null
}

// Combined agent data (real-time entity + metadata)
interface AgentData {
  avatar_id: string
  display_name: string
  position: { x: number; y: number }
  is_online: boolean
  conversation_state: string | null
  conversation_partner_id: string | null
  state: {
    energy: number
    hunger: number
    loneliness: number
    mood: number
  }
  personality: {
    sociability: number
    curiosity: number
    agreeableness: number
  }
  current_action: string | ActionObject
  last_action_time: string | null
}

// Helper to extract action name from current_action (can be string or object)
function getActionName(action: string | ActionObject): string {
  if (typeof action === 'string') {
    return action
  }
  return action.action || 'idle'
}

interface AgentSidebarProps {
  isOpen: boolean
  onToggle: () => void
  onFollowAgent?: (agentId: string) => void
  followingAgentId?: string | null
  // Real-time entity data from WebSocket
  entities?: Map<string, GameEntity>
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3003'

// Action icons/emojis for different actions
const ACTION_ICONS: Record<string, string> = {
  idle: '😴',
  wander: '🚶',
  walk_to_location: '📍',
  initiate_conversation: '💬',
  interact_food: '🍽️',
  interact_rest: '🛋️',
  interact_karaoke: '🎤',
  stand_still: '🧍',
}

// Format action name for display
function formatAction(action: string | ActionObject): string {
  const actionStr = typeof action === 'string' ? action : (action?.action || 'idle')
  return actionStr
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// Progress bar component
function StatBar({ 
  label, 
  value, 
  color,
  icon 
}: { 
  label: string
  value: number
  color: string
  icon: string
}) {
  const percentage = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-4">{icon}</span>
      <span className="w-16 text-gray-400">{label}</span>
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div 
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="w-8 text-right text-gray-300">{percentage}%</span>
    </div>
  )
}

// Individual agent card
function AgentCard({ agent, isExpanded, onToggle, onFollow, isFollowing, entities }: { 
  agent: AgentData
  isExpanded: boolean
  onToggle: () => void
  onFollow?: () => void
  isFollowing?: boolean
  entities?: Map<string, GameEntity>
}) {
  const actionName = getActionName(agent.current_action)
  const isInConversation = agent.conversation_state === 'IN_CONVERSATION'
  const isWalkingToConvo = agent.conversation_state === 'WALKING_TO_CONVERSATION'
  const hasPendingRequest = agent.conversation_state === 'PENDING_REQUEST'
  
  // Get partner name if in conversation
  const partnerName = agent.conversation_partner_id && entities 
    ? entities.get(agent.conversation_partner_id)?.displayName || 'Someone'
    : null
  
  // Determine icon and status
  let statusIcon = ACTION_ICONS[actionName] || '❓'
  let statusText = formatAction(actionName)
  let statusColor = 'text-gray-400'
  
  if (isInConversation && partnerName) {
    statusIcon = '💬'
    statusText = `Chatting with ${partnerName}`
    statusColor = 'text-green-400'
  } else if (isWalkingToConvo) {
    statusIcon = '🚶'
    statusText = 'Walking to chat...'
    statusColor = 'text-yellow-400'
  } else if (hasPendingRequest) {
    statusIcon = '⏳'
    statusText = 'Waiting for response...'
    statusColor = 'text-yellow-400'
  }
  
  return (
    <div className={`bg-gray-800/50 rounded-lg border overflow-hidden transition-all ${
      isFollowing ? 'border-blue-500 bg-blue-900/20' : 
      isInConversation ? 'border-green-500/50 bg-green-900/10' : 
      'border-gray-700/50'
    }`}>
      {/* Header - always visible */}
      <div className="flex items-center">
        <button 
          onClick={onToggle}
          className="flex-1 px-3 py-2 flex items-center gap-3 hover:bg-gray-700/30 transition-colors"
        >
        <span className="text-lg">{statusIcon}</span>
        <div className="flex-1 text-left min-w-0">
          <div className="font-medium text-white text-sm truncate flex items-center gap-2">
            {agent.display_name || 'Unknown'}
            {isInConversation && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/20 text-green-400">
                TALKING
              </span>
            )}
          </div>
          <div className={`text-xs truncate ${statusColor}`}>
            {statusText}
          </div>
        </div>
        <svg 
          className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        </button>
        {/* Follow button */}
        {onFollow && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onFollow()
            }}
            className={`px-3 py-2 border-l border-gray-700/50 transition-colors ${
              isFollowing 
                ? 'text-blue-400 hover:text-blue-300' 
                : 'text-gray-400 hover:text-white hover:bg-gray-700/30'
            }`}
            title={isFollowing ? 'Stop following' : 'Follow this agent'}
          >
            {isFollowing ? '👁️' : '📍'}
          </button>
        )}
      </div>
      
      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-gray-700/50">
          {/* Needs */}
          <div className="pt-3">
            <div className="text-xs font-medium text-gray-300 mb-2">Needs</div>
            <div className="space-y-1.5">
              <StatBar label="Energy" value={agent.state.energy} color="bg-yellow-500" icon="⚡" />
              <StatBar label="Hunger" value={1 - agent.state.hunger} color="bg-green-500" icon="🍔" />
              <StatBar label="Social" value={1 - agent.state.loneliness} color="bg-blue-500" icon="👥" />
              <StatBar label="Mood" value={(agent.state.mood + 1) / 2} color="bg-pink-500" icon="😊" />
            </div>
          </div>
          
          {/* Personality */}
          <div>
            <div className="text-xs font-medium text-gray-300 mb-2">Personality</div>
            <div className="space-y-1.5">
              <StatBar label="Social" value={agent.personality.sociability} color="bg-purple-500" icon="🗣️" />
              <StatBar label="Curious" value={agent.personality.curiosity} color="bg-cyan-500" icon="🔍" />
              <StatBar label="Agreeable" value={agent.personality.agreeableness} color="bg-orange-500" icon="🤝" />
            </div>
          </div>
          
          {/* Location */}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span>📍</span>
            <span>Position: ({agent.position.x}, {agent.position.y})</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AgentSidebar({ isOpen, onToggle, onFollowAgent, followingAgentId, entities }: AgentSidebarProps) {
  // Agent metadata from API (personality, current_action) - fetched less frequently
  const [agentMetadata, setAgentMetadata] = useState<Map<string, AgentMetadata>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  
  // Fetch agent metadata (personality, actions) - less frequent, supplementary data
  useEffect(() => {
    if (!isOpen) return
    
    const fetchMetadata = async () => {
      try {
        const response = await fetch(`${API_URL}/agents/all`)
        const data = await response.json()
        if (data.ok) {
          const metadataMap = new Map<string, AgentMetadata>()
          for (const agent of data.data) {
            metadataMap.set(agent.avatar_id, {
              avatar_id: agent.avatar_id,
              personality: agent.personality,
              current_action: agent.current_action,
              last_action_time: agent.last_action_time
            })
          }
          setAgentMetadata(metadataMap)
          setError(null)
        } else {
          setError('Failed to load agent metadata')
        }
      } catch (err) {
        setError('Failed to connect to server')
      } finally {
        setLoading(false)
      }
    }
    
    fetchMetadata()
    // Fetch metadata every 5 seconds - this is supplementary data
    const interval = setInterval(fetchMetadata, 5000)
    
    return () => clearInterval(interval)
  }, [isOpen])
  
  // Combine real-time entity data with agent metadata
  const agents = useMemo<AgentData[]>(() => {
    if (!entities) return []
    
    const result: AgentData[] = []
    for (const [entityId, entity] of entities) {
      // Skip walls
      if (entity.kind === 'WALL') continue
      
      const metadata = agentMetadata.get(entityId)
      
      result.push({
        avatar_id: entityId,
        display_name: entity.displayName || 'Unknown',
        position: { x: entity.x, y: entity.y },
        is_online: entity.kind === 'PLAYER',
        conversation_state: entity.conversationState || null,
        conversation_partner_id: entity.conversationPartnerId || null,
        state: {
          energy: entity.stats?.energy ?? 0.5,
          hunger: entity.stats?.hunger ?? 0.5,
          loneliness: entity.stats?.loneliness ?? 0.5,
          mood: entity.stats?.mood ?? 0.5,
        },
        personality: metadata?.personality ?? {
          sociability: 0.5,
          curiosity: 0.5,
          agreeableness: 0.5,
        },
        current_action: metadata?.current_action ?? 'idle',
        last_action_time: metadata?.last_action_time ?? null,
      })
    }
    
    return result
  }, [entities, agentMetadata])
  
  const toggleAgent = (avatarId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev)
      if (next.has(avatarId)) {
        next.delete(avatarId)
      } else {
        next.add(avatarId)
      }
      return next
    })
  }
  
  // Count agents currently in conversation (from real-time data)
  const talkingCount = agents.filter(a => a.conversation_state === 'IN_CONVERSATION').length
  
  return (
    <>
      {/* Compact status bar at bottom left - never overlaps with zoom controls */}
      <div 
        className={`fixed bottom-4 left-4 z-50 transition-all duration-300 ${
          isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <button
          onClick={onToggle}
          className="flex items-center gap-3 px-4 py-3 bg-gray-900/95 backdrop-blur-md border border-gray-700/50 rounded-xl shadow-lg hover:bg-gray-800/95 transition-colors"
          title="Show Agent Monitor"
        >
          <span className="text-xl">🤖</span>
          <div className="text-left">
            <div className="text-sm font-medium text-white">
              {agents.length} Agent{agents.length !== 1 ? 's' : ''}
            </div>
            {talkingCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-green-400">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                {talkingCount} talking
              </div>
            )}
          </div>
          <svg 
            className="w-4 h-4 text-gray-400 ml-2"
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      
      {/* Sidebar panel - slides in from left */}
      <div 
        className={`fixed top-0 left-0 w-80 h-screen bg-gray-900/95 backdrop-blur-md border-r border-gray-700/50 transform transition-transform duration-300 z-40 shadow-2xl ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="px-4 py-4 border-b border-gray-700/50 bg-gray-800/30">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <span>🤖</span> Agent Monitor
              </h2>
              <button
                onClick={onToggle}
                className="p-1.5 hover:bg-gray-700/50 rounded-lg transition-colors"
                title="Close"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs text-green-400">LIVE</span>
              </div>
              <span className="text-xs text-gray-500">•</span>
              <span className="text-xs text-gray-400">
                {agents.length} agent{agents.length !== 1 ? 's' : ''}
              </span>
              {talkingCount > 0 && (
                <>
                  <span className="text-xs text-gray-500">•</span>
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    💬 {talkingCount} talking
                  </span>
                </>
              )}
            </div>
          </div>
          
          {/* Agent list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading && agents.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                <div className="animate-spin w-6 h-6 border-2 border-gray-600 border-t-blue-500 rounded-full mx-auto mb-2" />
                Loading agents...
              </div>
            ) : error && agents.length === 0 ? (
              <div className="text-center text-red-400 py-8">
                {error}
              </div>
            ) : agents.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                No agents found
              </div>
            ) : (
              agents.map(agent => (
                <AgentCard
                  key={agent.avatar_id}
                  agent={agent}
                  isExpanded={expandedAgents.has(agent.avatar_id)}
                  onToggle={() => toggleAgent(agent.avatar_id)}
                  onFollow={onFollowAgent ? () => onFollowAgent(agent.avatar_id) : undefined}
                  isFollowing={followingAgentId === agent.avatar_id}
                  entities={entities}
                />
              ))
            )}
          </div>
          
          {/* Legend - simplified */}
          <div className="px-4 py-3 border-t border-gray-700/50 bg-gray-800/20">
            <div className="text-xs text-gray-500">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span title="Idle">😴 Idle</span>
                <span title="Walking">🚶 Walk</span>
                <span title="Talking">💬 Chat</span>
                <span title="Eating">🍽️ Eat</span>
                <span title="Resting">🛋️ Rest</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
