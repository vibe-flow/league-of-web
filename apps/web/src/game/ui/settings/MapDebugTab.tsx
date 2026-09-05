import { useGameSettingsStore } from '@/stores/game-settings.store'

type SliderKey = 'mapScale' | 'mapRotationY' | 'mapOffsetX' | 'mapOffsetY' | 'mapOffsetZ'

const SLIDERS: {
  key: SliderKey
  label: string
  desc: string
  min: number
  max: number
  step: number
  unit: string
}[] = [
  {
    key: 'mapScale',
    label: 'Echelle',
    desc: 'Scale=1 → le modele couvre 6000 unites',
    min: 0.1,
    max: 3,
    step: 0.01,
    unit: 'x',
  },
  {
    key: 'mapRotationY',
    label: 'Rotation Y',
    desc: "Rotation pour aligner le pont avec l'axe X du jeu",
    min: -180,
    max: 180,
    step: 1,
    unit: '°',
  },
  {
    key: 'mapOffsetX',
    label: 'Offset X',
    desc: 'Decalage horizontal (0 = centre sur MAP_WIDTH/2)',
    min: -3000,
    max: 3000,
    step: 25,
    unit: '',
  },
  {
    key: 'mapOffsetY',
    label: 'Offset Y',
    desc: 'Decalage vertical — descendre la map sous le champion',
    min: -2000,
    max: 500,
    step: 10,
    unit: '',
  },
  {
    key: 'mapOffsetZ',
    label: 'Offset Z',
    desc: 'Decalage profondeur (0 = centre sur MAP_HEIGHT/2)',
    min: -3000,
    max: 3000,
    step: 25,
    unit: '',
  },
]

const DEFAULTS: Record<SliderKey, number> = {
  mapScale: 3,
  mapRotationY: 90,
  mapOffsetX: 0,
  mapOffsetY: 500,
  mapOffsetZ: -225,
}

export default function MapDebugTab() {
  const store = useGameSettingsStore()

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium uppercase tracking-wider text-amber-500">Map Debug</h3>
      <p className="text-xs text-gray-500">
        Ajuste l'orientation et la position du modele 3D de la map en temps reel.
      </p>

      {/* Toggles */}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={store.mapFlipX}
            onChange={(e) => store.setMapFlip('mapFlipX', e.target.checked)}
            className="accent-amber-500"
          />
          Flip X
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={store.mapFlipZ}
            onChange={(e) => store.setMapFlip('mapFlipZ', e.target.checked)}
            className="accent-amber-500"
          />
          Flip Z
        </label>
        <label className="flex items-center gap-2 text-sm text-red-300">
          <input
            type="checkbox"
            checked={store.mapDebugHideStructures}
            onChange={(e) => store.setMapDebugHideStructures(e.target.checked)}
            className="accent-red-500"
          />
          Masquer tours/buissons
        </label>
        <label className="flex items-center gap-2 text-sm text-red-300">
          <input
            type="checkbox"
            checked={store.mapDebugHideMap}
            onChange={(e) => store.setMapDebugHideMap(e.target.checked)}
            className="accent-red-500"
          />
          Masquer map 3D (fond plat)
        </label>
      </div>

      {SLIDERS.map(({ key, label, desc, min, max, step, unit }) => (
        <div key={key} className="space-y-1">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-gray-300">{label}</label>
              <p className="text-xs text-gray-500">{desc}</p>
            </div>
            <span className="min-w-[5rem] text-right text-sm tabular-nums text-amber-200">
              {store[key]}
              {unit}
            </span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={store[key]}
            onChange={(e) => store.setMapDebug(key, Number(e.target.value))}
            className="slider w-full"
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>{min}</span>
            <button
              onClick={() => store.setMapDebug(key, DEFAULTS[key])}
              className="text-amber-600 hover:text-amber-400"
            >
              Reset ({DEFAULTS[key]})
            </button>
            <span>{max}</span>
          </div>
        </div>
      ))}

      {/* Structure scale slider */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm text-gray-300">Taille structures</label>
            <p className="text-xs text-gray-500">Multiplicateur de taille des tours/nexus</p>
          </div>
          <span className="min-w-[5rem] text-right text-sm tabular-nums text-amber-200">
            {store.structureScale}x
          </span>
        </div>
        <input
          type="range"
          min={0.01}
          max={3}
          step={0.01}
          value={store.structureScale}
          onChange={(e) => store.setStructureScale(Number(e.target.value))}
          className="slider w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>0.01</span>
          <button
            onClick={() => store.setStructureScale(1)}
            className="text-amber-600 hover:text-amber-400"
          >
            Reset (1)
          </button>
          <span>3</span>
        </div>
      </div>

      <button
        onClick={() => {
          for (const [k, v] of Object.entries(DEFAULTS)) {
            store.setMapDebug(k as SliderKey, v)
          }
          store.setMapFlip('mapFlipX', false)
          store.setMapFlip('mapFlipZ', false)
          store.setStructureScale(1)
        }}
        className="mt-2 w-full rounded bg-amber-700 px-3 py-2 text-sm text-white hover:bg-amber-600"
      >
        Reset tout
      </button>

      <div className="mt-3 rounded bg-black/30 p-3 text-xs text-gray-400">
        <p className="font-mono">
          scale={store.mapScale}x rot={store.mapRotationY}° off=({store.mapOffsetX},
          {store.mapOffsetY},{store.mapOffsetZ}) flipX={String(store.mapFlipX)} flipZ=
          {String(store.mapFlipZ)}
        </p>
      </div>
    </div>
  )
}
