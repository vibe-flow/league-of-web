import { useGameSettingsStore } from '@/stores/game-settings.store'
import { CAMERA_PAN_SPEED } from '@template-dev/shared'

const MIN_SPEED = 200
const MAX_SPEED = 2000
const STEP = 50

export default function CameraTab() {
  const edgePanSpeed = useGameSettingsStore((s) => s.edgePanSpeed)
  const keyPanSpeed = useGameSettingsStore((s) => s.keyPanSpeed)
  const cameraLocked = useGameSettingsStore((s) => s.cameraLocked)
  const setEdgePanSpeed = useGameSettingsStore((s) => s.setEdgePanSpeed)
  const setKeyPanSpeed = useGameSettingsStore((s) => s.setKeyPanSpeed)
  const setCameraLocked = useGameSettingsStore((s) => s.setCameraLocked)

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-medium uppercase tracking-wider text-amber-500">Camera</h3>

      {/* Camera lock toggle */}
      <div className="flex items-center justify-between rounded bg-white/[0.03] px-3 py-3">
        <div>
          <label className="text-sm text-gray-300">Caméra verrouillée sur le champion</label>
          <p className="text-xs text-gray-500">Touche Y en jeu pour toggle</p>
        </div>
        <button
          onClick={() => setCameraLocked(!cameraLocked)}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            cameraLocked ? 'bg-amber-600' : 'bg-gray-600'
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              cameraLocked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Edge pan speed */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-300">Vitesse de scroll (bords de l'ecran)</label>
          <span className="min-w-[3rem] text-right text-sm tabular-nums text-amber-200">
            {edgePanSpeed}
          </span>
        </div>
        <input
          type="range"
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={STEP}
          value={edgePanSpeed}
          onChange={(e) => setEdgePanSpeed(Number(e.target.value))}
          className="slider w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Lent</span>
          <button
            onClick={() => setEdgePanSpeed(CAMERA_PAN_SPEED)}
            className="text-amber-600 hover:text-amber-400"
          >
            Reset ({CAMERA_PAN_SPEED})
          </button>
          <span>Rapide</span>
        </div>
      </div>

      {/* Key pan speed */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-300">Vitesse de scroll (fleches clavier)</label>
          <span className="min-w-[3rem] text-right text-sm tabular-nums text-amber-200">
            {keyPanSpeed}
          </span>
        </div>
        <input
          type="range"
          min={MIN_SPEED}
          max={MAX_SPEED}
          step={STEP}
          value={keyPanSpeed}
          onChange={(e) => setKeyPanSpeed(Number(e.target.value))}
          className="slider w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Lent</span>
          <button
            onClick={() => setKeyPanSpeed(CAMERA_PAN_SPEED)}
            className="text-amber-600 hover:text-amber-400"
          >
            Reset ({CAMERA_PAN_SPEED})
          </button>
          <span>Rapide</span>
        </div>
      </div>
    </div>
  )
}
