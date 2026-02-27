import { useEffect, useRef, useState } from 'react'
import { GameMultiplayer } from './core/GameMultiplayer'
import SettingsMenu from './ui/settings/SettingsMenu'

interface Props {
  matchId: string
  playerId: string
  serverUrl: string
  token: string
}

export default function GameCanvasMultiplayer({ matchId, playerId, serverUrl, token }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<GameMultiplayer | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let game: GameMultiplayer | null = new GameMultiplayer(playerId)
    gameRef.current = game
    let cancelled = false

    game.onPauseChange = (paused) => setSettingsOpen(paused)

    game
      .init(canvas, matchId, serverUrl, token)
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
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100vw',
          height: '100vh',
          cursor: 'default',
        }}
      />
      {settingsOpen && <SettingsMenu onClose={handleCloseSettings} />}
    </>
  )
}
