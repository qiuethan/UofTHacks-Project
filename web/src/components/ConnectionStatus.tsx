interface ConnectionStatusProps {
  connected: boolean
}

export default function ConnectionStatus({ connected }: ConnectionStatusProps) {
  return (
    <div className={`mb-4 px-4 py-2 rounded text-sm ${
      connected ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'
    }`}>
      {connected ? 'Connected' : 'Disconnected - Reconnecting...'}
    </div>
  )
}
