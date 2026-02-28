import { useEffect, useRef, useState } from 'react'
import type { ChampionSnapshot } from '@template-dev/shared'
import { GameMultiplayer } from './core/GameMultiplayer'
import SettingsMenu from './ui/settings/SettingsMenu'
import StatsPanel from '@/components/game/StatsPanel'
import RespawnTimer from '@/components/game/RespawnTimer'

interface Props {
  matchId: string
  playerId: string
  serverUrl: string
  token: string
}

export default function GameCanvasMultiplayer({ matchId, playerId, serverUrl, token }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<GameMultiplayer | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [localPlayer, setLocalPlayer] = useState<ChampionSnapshot | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    let game: GameMultiplayer | null = new GameMultiplayer(playerId)
    gameRef.current = game

    let cancelled = false

    game.onPauseChange = (paused) => setSettingsOpen(paused)
    game.onLocalPlayerUpdate = (snapshot) => {
      if (snapshot?.type === 'champion') setLocalPlayer(snapshot)
    }

    game
      .init(canvas, container, matchId, serverUrl, token)
      .then(() => {
        if (cancelled) {
          game?.destroy()
          game = null
          gameRef.current = null
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to initialize multiplayer game:', err)
        }
      })

    return () => {
      cancelled = true
      if (game) {
        game.destroy()
        game = null
        gameRef.current = null
      }
    }
  }, [matchId, playerId, serverUrl, token])

  const handleCloseSettings = () => {
    gameRef.current?.setPaused(false)
    setSettingsOpen(false)
  }

  return (
    <>
      <div ref={containerRef} style={{ position: 'relative', width: '100vw', height: '100vh' }}>
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            cursor: 'default',
          }}
        />
      </div>
      <StatsPanel player={localPlayer} />
      <RespawnTimer player={localPlayer} />
      {settingsOpen && <SettingsMenu onClose={handleCloseSettings} />}
    </>
  )
}
