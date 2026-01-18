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
  const centerX1 = e1.x + 0.5
  const centerY1 = e1.y + 0.5
  const centerX2 = e2.x + 0.5
  const centerY2 = e2.y + 0.5
  
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
      <div className="bg-[#FFF8F0] border-2 border-black shadow-[2px_2px_0_#000] p-3 min-w-[160px] pointer-events-auto">
        <div className="text-[10px] font-bold text-black uppercase tracking-wider mb-1 text-center">Talk to {entity.displayName}?</div>
        
        {isOutOfRange && (
          <div className="text-black text-[9px] mb-2 leading-tight text-center">
            Too far ({distance.toFixed(1)})
          </div>
        )}

        {isOnCooldown && (
          <div className="text-black text-[9px] mb-2 leading-tight">
            On cooldown
          </div>
        )}

        <div className="flex gap-2">
          <button
            className={`flex-1 px-2 py-1 text-[10px] font-bold transition-colors border-2 border-black ${
              !canSend 
                ? 'bg-black/10 cursor-not-allowed text-black/40' 
                : 'bg-[#007a28] text-white hover:bg-[#009830]'
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
            className="btn-secondary px-2 py-1 text-black text-[10px] font-bold"
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
      <div className="w-2 h-2 bg-[#FFF8F0] border-r border-b border-black rotate-45 -mt-1"></div>
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
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-[#FFF8F0] border-2 border-black shadow-[4px_4px_0_#000] px-8 py-5 min-w-[360px] max-w-[450px]">
        <p className="text-black mb-2 text-center font-sans text-xl">
          <strong>{mostRecentRequest.initiatorName}</strong> wants to talk!
        </p>
        {/* Show the reason/message if provided */}
        {mostRecentRequest.reason && (
          <div className="mb-4 text-center">
            <p className="text-black/70 text-sm italic bg-white border-2 border-black px-4 py-2">
              "{mostRecentRequest.reason}"
            </p>
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <button
            className="btn-primary px-6 py-3 text-white text-base font-bold"
            onClick={() => onAccept(mostRecentRequest.requestId)}
          >
            Accept
          </button>
          <button
            className="btn-secondary px-6 py-3 text-black text-base font-semibold"
            onClick={() => onReject(mostRecentRequest.requestId)}
          >
            Decline
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
    <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-[#FFF8F0] border-2 border-black shadow-[4px_4px_0_#000] px-6 py-4 min-w-[300px]">
        <p className="text-black mb-3 text-center text-lg">
          Chatting with <strong>{partnerName}</strong>
        </p>
        <button
          className="btn-primary w-full px-4 py-2 text-white text-sm font-semibold"
          onClick={onEnd}
        >
          End Conversation
        </button>
      </div>
    </div>
  )
}
