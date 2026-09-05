import { useGameSettingsStore } from '@/stores/game-settings.store'

type CamKey = 'camPitch' | 'camYaw' | 'camDistance' | 'camFov'

const SLIDERS: {
  key: CamKey
  label: string
  desc: string
  min: number
  max: number
  step: number
}[] = [
  {
    key: 'camPitch',
    label: 'Inclinaison (pitch)',
    desc: '90° = dessus, 30° = très incliné',
    min: 10,
    max: 90,
    step: 1,
  },
  {
    key: 'camYaw',
    label: 'Rotation (yaw)',
    desc: 'Direction de la caméra autour du centre',
    min: -180,
    max: 180,
    step: 1,
  },
  {
    key: 'camDistance',
    label: 'Distance',
    desc: 'Distance de la caméra au point cible',
    min: 500,
    max: 5000,
    step: 50,
  },
  { key: 'camFov', label: 'FOV', desc: 'Champ de vision', min: 10, max: 120, step: 1 },
]

const DEFAULTS: Record<CamKey, number> = {
  camPitch: 45,
  camYaw: -90,
  camDistance: 1300,
  camFov: 60,
}

const DEFAULT_MODEL_ROTATION = 100

export default function CameraDebugTab() {
  const store = useGameSettingsStore()

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium uppercase tracking-wider text-amber-500">Camera Debug</h3>
      <p className="text-xs text-gray-500">
        La caméra tourne autour du champion. Ajuste les sliders en temps réel.
      </p>

      {SLIDERS.map(({ key, label, desc, min, max, step }) => (
        <div key={key} className="space-y-1">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-gray-300">{label}</label>
              <p className="text-xs text-gray-500">{desc}</p>
            </div>
            <span className="min-w-[4rem] text-right text-sm tabular-nums text-amber-200">
              {store[key]}°
            </span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={store[key]}
            onChange={(e) => store.setCamDebug(key, Number(e.target.value))}
            className="slider w-full"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{min}</span>
            <button
              onClick={() => store.setCamDebug(key, DEFAULTS[key])}
              className="text-amber-600 hover:text-amber-400"
            >
              Reset ({DEFAULTS[key]})
            </button>
            <span>{max}</span>
          </div>
        </div>
      ))}

      {/* Model rotation offset */}
      <h3 className="mt-4 text-sm font-medium uppercase tracking-wider text-amber-500">
        Modèle 3D
      </h3>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm text-gray-300">Rotation du modèle</label>
            <p className="text-xs text-gray-500">Corrige l'orientation du champion (0° = défaut)</p>
          </div>
          <span className="min-w-[4rem] text-right text-sm tabular-nums text-amber-200">
            {store.modelRotationOffset}°
          </span>
        </div>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={store.modelRotationOffset}
          onChange={(e) => store.setModelRotationOffset(Number(e.target.value))}
          className="slider w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>-180</span>
          <button
            onClick={() => store.setModelRotationOffset(DEFAULT_MODEL_ROTATION)}
            className="text-amber-600 hover:text-amber-400"
          >
            Reset ({DEFAULT_MODEL_ROTATION})
          </button>
          <span>180</span>
        </div>
      </div>

      <button
        onClick={() => {
          for (const [k, v] of Object.entries(DEFAULTS)) {
            store.setCamDebug(k as CamKey, v)
          }
          store.setModelRotationOffset(DEFAULT_MODEL_ROTATION)
        }}
        className="mt-2 w-full rounded bg-amber-700 px-3 py-2 text-sm text-white hover:bg-amber-600"
      >
        Reset tout
      </button>

      <div className="mt-3 rounded bg-black/30 p-3 text-xs text-gray-400">
        <p className="font-mono">
          pitch={store.camPitch}° yaw={store.camYaw}° dist={store.camDistance} fov={store.camFov}°
          rot={store.modelRotationOffset}°
        </p>
      </div>
    </div>
  )
}
