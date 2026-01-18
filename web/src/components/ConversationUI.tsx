import type { Entity, ConversationRequest } from '../types/game'
import { CONVERSATION_CONFIG } from '../config/constants'

interface ConversationRequestDialogProps {
  entity: Entity
  myEntity?: Entity
  isOnCooldown?: boolean
  onConfirm: () => void
  onCancel: () => void
}

function getDistance(e1: Entity, e2: Entity): number {
  const centerX1 = e1.x + 1
  const centerY1 = e1.y + 1
  const centerX2 = e2.x + 1
  const centerY2 = e2.y + 1
  
  return Math.sqrt(
    Math.pow(centerX2 - centerX1, 2) + 
    Math.pow(centerY2 - centerY1, 2)
  )
}

export function EntityActionBanner({ 
  entity, 
  myEntity, 
  isOnCooldown, 
  onConfirm, 
  onCancel 
}: ConversationRequestDialogProps) {
  if (!entity) return null
  
  const distance = myEntity ? getDistance(myEntity, entity) : 0
  const isOutOfRange = distance > CONVERSATION_CONFIG.INITIATION_RADIUS
  
  const canSend = !isOutOfRange && !isOnCooldown

  return (
    <div className="absolute bottom-[400%] left-0 w-[calc(200%+1px)] z-[100] flex flex-col items-center pointer-events-none">
      <div className="bg-gray-900 bg-opacity-90 backdrop-blur-sm p-3 rounded-lg shadow-2xl border border-gray-700 min-w-[160px] animate-in fade-in zoom-in duration-200 pointer-events-auto">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 text-center">Talk to {entity.displayName}?</div>
        
        {isOutOfRange && (
          <div className="text-red-400 text-[9px] mb-2 leading-tight text-center">
            Too far ({distance.toFixed(1)})
          </div>
        )}

        {isOnCooldown && (
          <div className="text-yellow-400 text-[9px] mb-2 leading-tight">
            On cooldown
          </div>
        )}

        <div className="flex gap-2">
          <button
            className={`flex-1 px-2 py-1 text-[10px] font-bold text-white rounded transition-colors ${
              !canSend 
                ? 'bg-gray-700 cursor-not-allowed text-gray-500' 
                : 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-900/20'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              onConfirm()
            }}
            disabled={!canSend}
          >
            Request
          </button>
          <button
            className="px-2 py-1 bg-gray-700 text-gray-300 text-[10px] font-bold rounded hover:bg-gray-600 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              onCancel()
            }}
          >
            ✕
          </button>
        </div>
      </div>
      {/* Little arrow pointing down */}
      <div className="w-2 h-2 bg-gray-900 bg-opacity-90 border-r border-b border-gray-700 rotate-45 -mt-1 shadow-xl"></div>
    </div>
  )
}

interface IncomingRequestsProps {
  requests: ConversationRequest[]
  onAccept: (requestId: string) => void
  onReject: (requestId: string) => void
}

export function IncomingRequests({ requests, onAccept, onReject }: IncomingRequestsProps) {
  if (requests.length === 0) return null
  
  // Show only the most recent request
  const mostRecentRequest = requests[requests.length - 1]
  
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-gray-900/95 backdrop-blur-md px-8 py-5 rounded-2xl shadow-2xl border-2 border-green-500/40 min-w-[360px]">
        <p className="text-white mb-4 text-center font-sans text-xl">
          <strong className="text-green-400">{mostRecentRequest.initiatorName}</strong> wants to talk!
        </p>
        <div className="flex gap-3 justify-center">
          <button
            className="px-6 py-3 bg-green-500 text-gray-900 rounded-xl text-base font-bold hover:bg-green-400 hover:scale-105 transition-all shadow-lg"
            onClick={() => onAccept(mostRecentRequest.requestId)}
          >
            ✓ Accept
          </button>
          <button
            className="px-6 py-3 bg-gray-700 text-gray-200 rounded-xl text-base font-semibold hover:bg-gray-600 hover:scale-105 transition-all"
            onClick={() => onReject(mostRecentRequest.requestId)}
          >
            ✕ Decline
          </button>
        </div>
      </div>
    </div>
  )
}

interface ActiveConversationProps {
  partnerName: string
  onEnd: () => void
}

export function ActiveConversation({ partnerName, onEnd }: ActiveConversationProps) {
  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-gray-900/80 backdrop-blur-md px-6 py-4 rounded-xl shadow-2xl border border-green-500/30 min-w-[300px]">
        <p className="text-white mb-3 text-center font-serif italic text-lg">
          Chatting with <strong className="text-green-400">{partnerName}</strong>
        </p>
        <button
          className="w-full px-4 py-2 bg-red-500/80 text-white rounded-lg text-sm font-semibold hover:bg-red-400 transition-all"
          onClick={onEnd}
        >
          End Conversation
        </button>
      </div>
    </div>
  )
}
