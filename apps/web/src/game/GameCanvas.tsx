import { useEffect, useRef, useState } from 'react'
import { Game } from './core/Game'
import SettingsMenu from './ui/settings/SettingsMenu'

export default function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let game: Game | null = new Game()
    gameRef.current = game
    let cancelled = false

    game.onPauseChange = (paused) => setSettingsOpen(paused)

    game
      .init(canvas)
      .then(() => {
        if (cancelled) {
          game?.destroy()
          game = null
          gameRef.current = null
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to initialize game:', err)
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
  }, [])

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
      {settingsOpen && <SettingsMenu onClose={handleCloseSettings} />}
    </>
  )
}
