interface ConnectionStatusProps {
  connected: boolean
}

export default function ConnectionStatus({ connected }: ConnectionStatusProps) {
  return (
    <div className={`mb-4 px-4 py-2 text-sm border border-black ${
      connected ? 'bg-[#FFF8F0] text-black' : 'bg-[#FFF8F0] text-black'
    }`}>
      {connected ? 'Connected' : 'Disconnected - Reconnecting...'}
    </div>
  )
}
