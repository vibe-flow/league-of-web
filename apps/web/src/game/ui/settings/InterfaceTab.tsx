import { useGameSettingsStore } from '@/stores/game-settings.store'

const MIN_SCALE = 0.3
const MAX_SCALE = 2
const STEP = 0.1

export default function InterfaceTab() {
  const minimapScale = useGameSettingsStore((s) => s.minimapScale)
  const setMinimapScale = useGameSettingsStore((s) => s.setMinimapScale)

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-medium uppercase tracking-wider text-amber-500">Interface</h3>

      {/* Minimap size */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-300">Taille de la minimap</label>
          <span className="min-w-[3rem] text-right text-sm tabular-nums text-amber-200">
            {Math.round(minimapScale * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={STEP}
          value={minimapScale}
          onChange={(e) => setMinimapScale(Number(e.target.value))}
          className="slider w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Petit</span>
          <button
            onClick={() => setMinimapScale(1)}
            className="text-amber-600 hover:text-amber-400"
          >
            Reset (100%)
          </button>
          <span>Grand</span>
        </div>
      </div>
    </div>
  )
}
