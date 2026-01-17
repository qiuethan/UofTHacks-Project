import type { Entity, ConversationRequest } from '../types/game'

interface ConversationRequestDialogProps {
  entity: Entity
  onConfirm: () => void
  onCancel: () => void
}

export function ConversationRequestDialog({ entity, onConfirm, onCancel }: ConversationRequestDialogProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg shadow-xl max-w-sm">
        <h3 className="text-lg font-bold text-white mb-2">Request Conversation</h3>
        <p className="text-gray-300 mb-4">
          Send conversation request to <strong>{entity.displayName}</strong>?
        </p>
        <div className="flex gap-2">
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={onConfirm}
          >
            Send Request
          </button>
          <button
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
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
  
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2">
      {requests.map(req => (
        <div key={req.requestId} className="bg-gray-800 p-4 rounded-lg shadow-xl">
          <p className="text-white mb-2">
            <strong>{req.initiatorName}</strong> wants to talk!
          </p>
          <div className="flex gap-2">
            <button
              className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
              onClick={() => onAccept(req.requestId)}
            >
              Accept
            </button>
            <button
              className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
              onClick={() => onReject(req.requestId)}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

interface ActiveConversationProps {
  partnerName: string
  onEnd: () => void
}

export function ActiveConversation({ partnerName, onEnd }: ActiveConversationProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 bg-green-800 p-4 rounded-lg shadow-xl">
      <p className="text-white mb-2">
        In conversation with <strong>{partnerName}</strong>
      </p>
      <button
        className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
        onClick={onEnd}
      >
        End Conversation
      </button>
    </div>
  )
}
