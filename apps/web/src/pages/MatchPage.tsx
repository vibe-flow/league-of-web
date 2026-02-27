import { useParams } from 'react-router-dom'
import { useUser, useAccessToken } from '@/stores/auth.store'
import GameCanvasMultiplayer from '@/game/GameCanvasMultiplayer'

const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export default function MatchPage() {
  const { matchId } = useParams<{ matchId: string }>()
  const user = useUser()
  const token = useAccessToken()

  if (!matchId || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <p className="text-gray-400">Loading match...</p>
      </div>
    )
  }

  return (
    <GameCanvasMultiplayer
      matchId={matchId}
      playerId={user.id}
      serverUrl={SERVER_URL}
      token={token || 'dev'}
    />
  )
}
