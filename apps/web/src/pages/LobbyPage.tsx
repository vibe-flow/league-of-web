import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { trpc } from '@/lib/trpc'
import { useUser } from '@/stores/auth.store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { LobbyState, Team } from '@template-dev/shared'

export default function LobbyPage() {
  const navigate = useNavigate()
  const user = useUser()
  const [lobbyId, setLobbyId] = useState<string | null>(null)
  const [joinInput, setJoinInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createMutation = trpc.lobby.create.useMutation({
    onSuccess: (lobby: LobbyState) => {
      setLobbyId(lobby.id)
      setError(null)
    },
    onError: (err) => setError(err.message),
  })

  const joinMutation = trpc.lobby.join.useMutation({
    onSuccess: (lobby: LobbyState) => {
      setLobbyId(lobby.id)
      setError(null)
    },
    onError: (err) => setError(err.message),
  })

  const setTeamMutation = trpc.lobby.setTeam.useMutation({
    onError: (err) => setError(err.message),
  })

  const setReadyMutation = trpc.lobby.setReady.useMutation({
    onError: (err) => setError(err.message),
  })

  const startMutation = trpc.lobby.start.useMutation({
    onSuccess: (data) => {
      navigate(`/game/${data.matchId}`)
    },
    onError: (err) => setError(err.message),
  })

  // Poll lobby state every 2 seconds
  const { data: lobby } = trpc.lobby.get.useQuery(
    { lobbyId: lobbyId! },
    {
      enabled: !!lobbyId,
      refetchInterval: 2000,
    },
  )

  // Redirect if match started (for non-host players)
  useEffect(() => {
    if (lobby?.status === 'in_progress' && lobby.matchId) {
      navigate(`/game/${lobby.matchId}`)
    }
  }, [lobby?.status, lobby?.matchId, navigate])

  const currentPlayer = lobby?.players.find((p) => p.userId === user?.id)
  const isHost = lobby?.hostId === user?.id
  const allReady = lobby?.players.every((p) => p.ready) ?? false
  const canStart = isHost && allReady && (lobby?.players.length ?? 0) >= 2

  const handleCreate = () => {
    createMutation.mutate()
  }

  const handleJoin = () => {
    if (!joinInput.trim()) return
    joinMutation.mutate({ lobbyId: joinInput.trim() })
  }

  const handleSetTeam = (team: Team) => {
    if (!lobbyId) return
    setTeamMutation.mutate({ lobbyId, team })
  }

  const handleToggleReady = () => {
    if (!lobbyId || !currentPlayer) return
    setReadyMutation.mutate({ lobbyId, ready: !currentPlayer.ready })
  }

  const handleStart = () => {
    if (!lobbyId) return
    startMutation.mutate({ lobbyId })
  }

  // =========================================================================
  // No lobby yet — show create/join
  // =========================================================================
  if (!lobbyId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <Card className="w-96 border-gray-800 bg-gray-900">
          <CardHeader>
            <CardTitle className="text-center text-2xl">League of Web</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleCreate} className="w-full" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Lobby'}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-700" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-gray-900 px-2 text-gray-400">or</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="Lobby ID"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
                className="border-gray-700 bg-gray-800"
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              />
              <Button onClick={handleJoin} disabled={joinMutation.isPending} variant="outline">
                Join
              </Button>
            </div>

            <Button
              onClick={() => navigate('/game')}
              variant="ghost"
              className="w-full text-gray-400"
            >
              Solo Practice
            </Button>

            {error && <p className="text-center text-sm text-red-400">{error}</p>}
          </CardContent>
        </Card>
      </div>
    )
  }

  // =========================================================================
  // In lobby — show players and controls
  // =========================================================================
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
      <Card className="w-[500px] border-gray-800 bg-gray-900">
        <CardHeader>
          <CardTitle className="text-center text-xl">Lobby</CardTitle>
          <p className="select-all text-center text-xs text-gray-500">{lobbyId}</p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Players */}
          <div className="space-y-3">
            {lobby?.players.map((player) => (
              <div
                key={player.userId}
                className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`h-3 w-3 rounded-full ${
                      player.team === 'blue' ? 'bg-blue-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="text-sm">
                    {player.userId === user?.id ? 'You' : player.userId.slice(0, 8)}
                    {player.userId === lobby.hostId && (
                      <span className="ml-1 text-yellow-500">*</span>
                    )}
                  </span>
                </div>
                <span
                  className={`text-xs font-medium ${
                    player.ready ? 'text-green-400' : 'text-gray-500'
                  }`}
                >
                  {player.ready ? 'Ready' : 'Not Ready'}
                </span>
              </div>
            ))}

            {(lobby?.players.length ?? 0) < 2 && (
              <div className="rounded-lg border border-dashed border-gray-700 px-4 py-3 text-center text-sm text-gray-500">
                Waiting for opponent...
              </div>
            )}
          </div>

          {/* Team selection */}
          <div className="flex gap-3">
            <Button
              onClick={() => handleSetTeam('blue')}
              variant={currentPlayer?.team === 'blue' ? 'default' : 'outline'}
              className={`flex-1 ${
                currentPlayer?.team === 'blue'
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'border-blue-600 text-blue-400'
              }`}
            >
              Blue Team
            </Button>
            <Button
              onClick={() => handleSetTeam('red')}
              variant={currentPlayer?.team === 'red' ? 'default' : 'outline'}
              className={`flex-1 ${
                currentPlayer?.team === 'red'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'border-red-600 text-red-400'
              }`}
            >
              Red Team
            </Button>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button onClick={handleToggleReady} variant="outline" className="flex-1">
              {currentPlayer?.ready ? 'Unready' : 'Ready'}
            </Button>

            {isHost && (
              <Button
                onClick={handleStart}
                disabled={!canStart || startMutation.isPending}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {startMutation.isPending ? 'Starting...' : 'Start Match'}
              </Button>
            )}
          </div>

          {error && <p className="text-center text-sm text-red-400">{error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
