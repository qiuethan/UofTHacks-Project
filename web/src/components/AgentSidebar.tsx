import { useState, useEffect, useMemo, useRef } from 'react'
import type { GameEntity } from '../game/types'
import { 
  Moon, Footprints, MapPin, MessageCircle, Utensils, Sofa, Mic, 
  User, Clock, Zap, Apple, Users, Smile, Search, Heart,
  ChevronDown, ChevronRight, X, Crosshair, Bot, Radio, Compass
} from 'lucide-react'

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

// Relationship stats between two agents
interface RelationshipStats {
  sentiment: number
  familiarity: number
  interaction_count: number
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
  is_moving: boolean  // Detected from position changes
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

// Player activity state type
type PlayerActivityState = 'idle' | 'walking' | 'talking' | 'eating' | 'resting' | 'socializing' | 'singing' | 'wandering'

interface AgentSidebarProps {
  isOpen: boolean
  onToggle: () => void
  onFollowAgent?: (agentId: string) => void
  followingAgentId?: string | null
  // Real-time entity data from WebSocket
  entities?: Map<string, GameEntity>
  // Current user's activity state (for showing in the sidebar)
  myEntityId?: string | null
  myActivityState?: PlayerActivityState
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3003'

// Action icon components using Lucide React
const ACTION_ICONS: Record<string, React.ReactNode> = {
  idle: <Moon size={16} />,
  wander: <Footprints size={16} />,
  walk_to_location: <MapPin size={16} />,
  initiate_conversation: <MessageCircle size={16} />,
  interact_food: <Utensils size={16} />,
  interact_rest: <Sofa size={16} />,
  interact_karaoke: <Mic size={16} />,
  interact_social_hub: <Users size={16} />,
  interact_wander_point: <Compass size={16} />,
  stand_still: <User size={16} />,
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
  icon: React.ReactNode
}) {
  const percentage = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-5 text-black/60">{icon}</span>
      <span className="w-14 text-black/60">{label}</span>
      <div className="flex-1 h-2 bg-black/10 border border-black overflow-hidden">
        <div 
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="w-8 text-right text-black font-medium">{percentage}%</span>
    </div>
  )
}

// Helper to get sentiment label and color
function getSentimentInfo(sentiment: number) {
  if (sentiment >= 0.7) return { label: 'Loves', color: 'text-[#007a28]', bgColor: 'bg-[#007a28]' }
  if (sentiment >= 0.6) return { label: 'Likes', color: 'text-[#00a938]', bgColor: 'bg-[#00a938]' }
  if (sentiment >= 0.45) return { label: 'Neutral', color: 'text-black/60', bgColor: 'bg-black/40' }
  if (sentiment >= 0.3) return { label: 'Dislikes', color: 'text-[#7a5224]', bgColor: 'bg-[#7a5224]' }
  return { label: 'Hates', color: 'text-red-600', bgColor: 'bg-red-600' }
}

// Helper to get familiarity label
function getFamiliarityInfo(familiarity: number) {
  if (familiarity >= 0.8) return { label: 'Best friends', color: 'text-[#007a28]', bgColor: 'bg-[#007a28]' }
  if (familiarity >= 0.6) return { label: 'Good friends', color: 'text-[#00a938]', bgColor: 'bg-[#00a938]' }
  if (familiarity >= 0.4) return { label: 'Acquaintances', color: 'text-[#7a5224]', bgColor: 'bg-[#7a5224]' }
  if (familiarity >= 0.2) return { label: 'Just met', color: 'text-black/60', bgColor: 'bg-black/40' }
  return { label: 'Strangers', color: 'text-black/40', bgColor: 'bg-black/20' }
}

// Individual agent card
function AgentCard({ agent, isExpanded, onToggle, onFollow, isFollowing, entities, relationshipStats }: { 
  agent: AgentData
  isExpanded: boolean
  onToggle: () => void
  onFollow?: () => void
  isFollowing?: boolean
  entities?: Map<string, GameEntity>
  relationshipStats?: RelationshipStats | null
}) {
  const actionName = getActionName(agent.current_action)
  const isInConversation = agent.conversation_state === 'IN_CONVERSATION'
  const isWalkingToConvo = agent.conversation_state === 'WALKING_TO_CONVERSATION'
  const hasPendingRequest = agent.conversation_state === 'PENDING_REQUEST'
  
  // Get partner name if in conversation
  const partnerName = agent.conversation_partner_id && entities 
    ? entities.get(agent.conversation_partner_id)?.displayName || 'Someone'
    : null
  
  // Determine icon and status - prioritize real-time detection over API metadata
  let statusIcon: React.ReactNode = ACTION_ICONS[actionName] || <User size={16} />
  let statusText = formatAction(actionName)
  let statusColor = 'text-black/60'
  
  // Conversation states take priority
  if (isInConversation && partnerName) {
    statusIcon = <MessageCircle size={16} className="text-[#007a28]" />
    statusText = `Chatting with ${partnerName}`
    statusColor = 'text-[#007a28]'
  } else if (isWalkingToConvo) {
    statusIcon = <Footprints size={16} className="text-[#7a5224]" />
    statusText = 'Walking to chat...'
    statusColor = 'text-[#7a5224]'
  } else if (hasPendingRequest) {
    statusIcon = <Clock size={16} className="text-[#7a5224]" />
    statusText = 'Waiting for response...'
    statusColor = 'text-[#7a5224]'
  } 
  // Activity states
  else if (actionName === 'interact_food') {
    statusIcon = <Utensils size={16} className="text-[#007a28]" />
    statusText = 'Eating...'
    statusColor = 'text-[#007a28]'
  } else if (actionName === 'interact_karaoke') {
    statusIcon = <Mic size={16} className="text-[#007a28]" />
    statusText = 'Singing karaoke...'
    statusColor = 'text-[#007a28]'
  } else if (actionName === 'interact_rest') {
    statusIcon = <Sofa size={16} className="text-[#7a5224]" />
    statusText = 'Resting...'
    statusColor = 'text-[#7a5224]'
  } else if (actionName === 'interact_social_hub') {
    statusIcon = <Users size={16} className="text-[#007a28]" />
    statusText = 'Socializing...'
    statusColor = 'text-[#007a28]'
  } else if (actionName === 'interact_wander_point') {
    statusIcon = <Compass size={16} className="text-[#007a28]" />
    statusText = 'Exploring...'
    statusColor = 'text-[#007a28]'
  } 
  // Movement states - ONLY if action is explicitly walking (not just position change)
  else if (actionName === 'walk_to_location' || actionName === 'wander') {
    // Explicitly walking to somewhere
    statusIcon = <Footprints size={16} className="text-black/60" />
    statusText = 'Walking...'
    statusColor = 'text-black/60'
  } 
  // Idle states - not doing anything specific (ignore is_moving - use action state)
  else {
    // Default to idling when not doing any other action
    statusIcon = <Moon size={16} className="text-black/40" />
    statusText = 'Idling'
    statusColor = 'text-black/40'
  }
  
  return (
    <div className={`bg-[#FFF8F0] border-2 overflow-hidden transition-all ${
      isFollowing ? 'border-[#007a28] shadow-[3px_3px_0_#007a28]' : 
      isInConversation ? 'border-[#007a28]' : 
      'border-black'
    }`}>
      {/* Header - always visible */}
      <div className="flex items-center">
        <button 
          onClick={onToggle}
          className="flex-1 px-3 py-2 flex items-center gap-3 hover:bg-black/5 transition-colors"
        >
        <span className="text-black">{statusIcon}</span>
        <div className="flex-1 text-left min-w-0">
          <div className="font-medium text-black text-sm truncate flex items-center gap-2">
            {agent.display_name || 'Unknown'}
            {isInConversation && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold bg-[#007a28] text-white border border-black">
                TALKING
              </span>
            )}
          </div>
          <div className={`text-xs truncate ${statusColor}`}>
            {statusText}
          </div>
        </div>
        <ChevronDown 
          size={16} 
          className={`text-black/60 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
        />
        </button>
        {/* Follow button */}
        {onFollow && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onFollow()
            }}
            className={`px-3 py-2 border-l-2 border-black transition-colors ${
              isFollowing 
                ? 'bg-[#007a28] text-white' 
                : 'text-black hover:bg-[#bae854]'
            }`}
            title={isFollowing ? 'Stop following' : 'Follow this agent'}
          >
            {isFollowing ? <X size={14} /> : <Crosshair size={14} />}
          </button>
        )}
      </div>
      
      {/* Expanded details */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t-2 border-black/20">
          {/* Relationship Stats - Only show when in conversation */}
          {isInConversation && relationshipStats && partnerName && (
            <div className="pt-3">
              <div className="text-xs font-bold text-black mb-2 flex items-center gap-2">
                <Heart size={12} className="text-[#007a28]" /> Relationship with {partnerName}
              </div>
              <div className="space-y-1.5">
                {/* Sentiment */}
                <div className="flex items-center gap-2 text-xs">
                  <Smile size={14} className="text-black/60" />
                  <span className="w-14 text-black/60">Sentiment</span>
                  <div className="flex-1 h-2 bg-black/10 border border-black overflow-hidden">
                    <div 
                      className={`h-full ${getSentimentInfo(relationshipStats.sentiment).bgColor} transition-all duration-300`}
                      style={{ width: `${relationshipStats.sentiment * 100}%` }}
                    />
                  </div>
                  <span className={`w-24 text-right text-xs font-medium ${getSentimentInfo(relationshipStats.sentiment).color}`}>
                    {getSentimentInfo(relationshipStats.sentiment).label} <span className="text-black/40 font-mono">({(relationshipStats.sentiment * 100).toFixed(0)}%)</span>
                  </span>
                </div>
                
                {/* Familiarity */}
                <div className="flex items-center gap-2 text-xs">
                  <Users size={14} className="text-black/60" />
                  <span className="w-14 text-black/60">Familiar</span>
                  <div className="flex-1 h-2 bg-black/10 border border-black overflow-hidden">
                    <div 
                      className={`h-full ${getFamiliarityInfo(relationshipStats.familiarity).bgColor} transition-all duration-300`}
                      style={{ width: `${relationshipStats.familiarity * 100}%` }}
                    />
                  </div>
                  <span className={`w-24 text-right text-xs font-medium ${getFamiliarityInfo(relationshipStats.familiarity).color}`}>
                    {getFamiliarityInfo(relationshipStats.familiarity).label} <span className="text-black/40 font-mono">({(relationshipStats.familiarity * 100).toFixed(0)}%)</span>
                  </span>
                </div>
                
                {/* Interaction Count */}
                <div className="flex items-center gap-2 text-xs">
                  <MessageCircle size={14} className="text-black/60" />
                  <span className="w-14 text-black/60">Chats</span>
                  <span className="text-[#007a28] font-bold">{relationshipStats.interaction_count}</span>
                  <span className="text-black/60">conversations</span>
                </div>
              </div>
            </div>
          )}
          
          {/* Needs */}
          <div className={isInConversation && relationshipStats ? "" : "pt-3"}>
            <div className="text-xs font-bold text-black mb-2">Needs</div>
            <div className="space-y-1.5">
              <StatBar label="Energy" value={agent.state.energy} color="bg-[#bae854]" icon={<Zap size={14} />} />
              <StatBar label="Hunger" value={1 - agent.state.hunger} color="bg-[#007a28]" icon={<Apple size={14} />} />
              <StatBar label="Social" value={1 - agent.state.loneliness} color="bg-[#7a5224]" icon={<Users size={14} />} />
              <StatBar label="Mood" value={(agent.state.mood + 1) / 2} color="bg-[#00a938]" icon={<Smile size={14} />} />
            </div>
          </div>
          
          {/* Personality */}
          <div>
            <div className="text-xs font-bold text-black mb-2">Personality</div>
            <div className="space-y-1.5">
              <StatBar label="Social" value={agent.personality.sociability} color="bg-[#7a5224]" icon={<Users size={14} />} />
              <StatBar label="Curious" value={agent.personality.curiosity} color="bg-[#00a938]" icon={<Search size={14} />} />
              <StatBar label="Agree" value={agent.personality.agreeableness} color="bg-[#bae854]" icon={<Heart size={14} />} />
            </div>
          </div>
          
          {/* Location */}
          <div className="flex items-center gap-2 text-xs text-black/60">
            <MapPin size={14} />
            <span>Position: ({agent.position.x}, {agent.position.y})</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AgentSidebar({ isOpen, onToggle, onFollowAgent, followingAgentId, entities, myEntityId, myActivityState }: AgentSidebarProps) {
  // Agent metadata from API (personality, current_action) - fetched less frequently
  const [agentMetadata, setAgentMetadata] = useState<Map<string, AgentMetadata>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  // Relationship stats for agents in conversation
  const [relationshipStats, setRelationshipStats] = useState<Map<string, RelationshipStats>>(new Map())
  
  // Track previous positions to detect movement
  const prevPositionsRef = useRef<Map<string, { x: number; y: number; time: number }>>(new Map())
  const [movingAgents, setMovingAgents] = useState<Set<string>>(new Set())
  
  // Detect movement by comparing current positions to previous positions
  useEffect(() => {
    if (!entities) return
    
    const now = Date.now()
    const newMoving = new Set<string>()
    const newPrevPositions = new Map<string, { x: number; y: number; time: number }>()
    
    for (const [entityId, entity] of entities) {
      if (entity.kind === 'WALL') continue
      
      const prev = prevPositionsRef.current.get(entityId)
      const currentPos = { x: entity.x, y: entity.y, time: now }
      
      if (prev) {
        // Check if position changed within last 2 seconds
        const posChanged = prev.x !== entity.x || prev.y !== entity.y
        if (posChanged) {
          newMoving.add(entityId)
          newPrevPositions.set(entityId, currentPos)
        } else if (now - prev.time < 2000) {
          // Keep as moving if it was moving recently (within 2 seconds)
          if (movingAgents.has(entityId)) {
            newMoving.add(entityId)
          }
          newPrevPositions.set(entityId, prev) // Keep old timestamp
        } else {
          newPrevPositions.set(entityId, currentPos)
        }
      } else {
        newPrevPositions.set(entityId, currentPos)
      }
    }
    
    prevPositionsRef.current = newPrevPositions
    setMovingAgents(newMoving)
  }, [entities])
  
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
  
  // Fetch relationship stats for agents in conversation
  useEffect(() => {
    if (!isOpen || !entities) return
    
    const fetchRelationshipStats = async () => {
      const newStats = new Map<string, RelationshipStats>()
      
      for (const [entityId, entity] of entities) {
        if (entity.conversationState === 'IN_CONVERSATION' && entity.conversationPartnerId) {
          try {
            const response = await fetch(
              `${API_URL}/relationship/${entityId}/${entity.conversationPartnerId}`
            )
            const data = await response.json()
            if (data.ok) {
              newStats.set(entityId, {
                sentiment: data.sentiment,
                familiarity: data.familiarity,
                interaction_count: data.interaction_count
              })
            }
          } catch (err) {
            console.error('Error fetching relationship stats:', err)
          }
        }
      }
      
      setRelationshipStats(newStats)
    }
    
    fetchRelationshipStats()
    // Refresh relationship stats every 3 seconds while sidebar is open
    const interval = setInterval(fetchRelationshipStats, 3000)
    
    return () => clearInterval(interval)
  }, [isOpen, entities])
  
  // Map player activity state to action string for display
  const activityToAction = (activity: PlayerActivityState): string => {
    switch (activity) {
      case 'eating': return 'interact_food'
      case 'resting': return 'interact_rest'
      case 'socializing': return 'interact_social_hub'
      case 'singing': return 'interact_karaoke'
      case 'wandering': return 'interact_wander_point'
      case 'walking': return 'wander'
      case 'talking': return 'in_conversation'
      default: return 'idle'
    }
  }

  // Combine real-time entity data with agent metadata
  const agents = useMemo<AgentData[]>(() => {
    if (!entities) return []
    
    const result: AgentData[] = []
    for (const [entityId, entity] of entities) {
      // Skip walls
      if (entity.kind === 'WALL') continue
      
      const metadata = agentMetadata.get(entityId)
      const isMoving = movingAgents.has(entityId)
      const isMe = entityId === myEntityId
      
      // Prefer real-time current_action from WebSocket, fall back to API metadata
      // For the current user, use their local activity state if provided
      let currentAction: string | ActionObject = 
        entity.stats?.current_action || metadata?.current_action || 'idle'
      if (isMe && myActivityState) {
        currentAction = activityToAction(myActivityState)
      }
      
      result.push({
        avatar_id: entityId,
        display_name: entity.displayName || 'Unknown',
        position: { x: entity.x, y: entity.y },
        is_online: entity.kind === 'PLAYER',
        is_moving: isMoving,
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
        current_action: currentAction,
        last_action_time: metadata?.last_action_time ?? null,
      })
    }
    
    return result
  }, [entities, agentMetadata, movingAgents, myEntityId, myActivityState])
  
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
        className={`fixed bottom-4 left-4 z-[30] transition-all duration-300 ${
          isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <button
          onClick={onToggle}
          className="flex items-center gap-3 px-4 py-3 bg-[#FFF8F0] border-2 border-black shadow-[3px_3px_0_#000] hover:shadow-[1px_1px_0_#000] hover:translate-x-[2px] hover:translate-y-[2px] transition-all"
          title="Show Agent Monitor"
        >
          <Bot size={24} className="text-black" />
          <div className="text-left">
            <div className="text-sm font-bold text-black">
              {agents.length} Agent{agents.length !== 1 ? 's' : ''}
            </div>
            {talkingCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-[#007a28] font-medium">
                <span className="w-1.5 h-1.5 bg-[#007a28] rounded-full animate-pulse" />
                {talkingCount} talking
              </div>
            )}
          </div>
          <ChevronRight size={20} className="text-black ml-2" />
        </button>
      </div>
      
      {/* Sidebar panel - slides in from left, below header */}
      <div 
        className={`fixed top-[80px] left-0 w-80 h-[calc(100vh-80px)] bg-[#FFF8F0] transform transition-transform duration-300 z-40 ${
          isOpen ? 'translate-x-0 border-r-2 border-black shadow-[4px_0_0_#000]' : '-translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="px-4 py-4 border-b-2 border-black bg-[#d9c9a8]">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-black flex items-center gap-2">
                <Bot size={20} /> Agent Monitor
              </h2>
              <button
                onClick={onToggle}
                className="p-1.5 hover:bg-black/10 border-2 border-black transition-colors"
                title="Close"
              >
                <X size={20} className="text-black" />
              </button>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <div className="flex items-center gap-1.5">
                <Radio size={12} className="text-[#007a28] animate-pulse" />
                <span className="text-xs text-[#007a28] font-bold">LIVE</span>
              </div>
              <span className="text-xs text-black/40">|</span>
              <span className="text-xs text-black/60 font-medium">
                {agents.length} agent{agents.length !== 1 ? 's' : ''}
              </span>
              {talkingCount > 0 && (
                <>
                  <span className="text-xs text-black/40">|</span>
                  <span className="text-xs text-[#007a28] font-medium flex items-center gap-1">
                    <MessageCircle size={12} /> {talkingCount} talking
                  </span>
                </>
              )}
            </div>
          </div>
          
          {/* Agent list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading && agents.length === 0 ? (
              <div className="text-center text-black/60 py-8">
                <div className="animate-spin w-6 h-6 border-2 border-black border-t-[#007a28] mx-auto mb-2" />
                Loading agents...
              </div>
            ) : error && agents.length === 0 ? (
              <div className="text-center text-red-600 py-8 font-medium">
                {error}
              </div>
            ) : agents.length === 0 ? (
              <div className="text-center text-black/60 py-8">
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
                  relationshipStats={relationshipStats.get(agent.avatar_id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  )
}
