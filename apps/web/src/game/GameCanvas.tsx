import { useEffect, useRef, useState } from 'react'
import { Game } from './core/Game'
import SettingsMenu from './ui/settings/SettingsMenu'
import HudBar from './ui/hud/HudBar'

export default function GameCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const toggleSettings = useRef(() => {})
  const closeSettings = useRef(() => {})

  // Keep refs updated so the Game callback never uses stale closures
  toggleSettings.current = () => {
    const next = !settingsOpen
    setSettingsOpen(next)
    gameRef.current?.setPaused(next)
  }
  closeSettings.current = () => {
    setSettingsOpen(false)
    gameRef.current?.setPaused(false)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let game: Game | null = new Game()
    gameRef.current = game
    let cancelled = false

    // Game notifies us that Escape was pressed — we handle all state
    game.onEscapePressed = () => toggleSettings.current()

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
      <HudBar />
      {settingsOpen && <SettingsMenu onClose={() => closeSettings.current()} />}
    </>
  )
}
