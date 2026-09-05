import { useMemo, useState } from 'react'
import { CHAMPION_CATALOG, CHAMPION_LIST } from '@template-dev/shared'
import { useGameSettingsStore } from '@/stores/game-settings.store'

export default function ChampionTab() {
  const selectedChampion = useGameSettingsStore((s) => s.selectedChampion)
  const selectedSkin = useGameSettingsStore((s) => s.selectedSkin)
  const modelScale = useGameSettingsStore((s) => s.modelScale)
  const championHeight = useGameSettingsStore((s) => s.championHeight)
  const setSelectedChampion = useGameSettingsStore((s) => s.setSelectedChampion)
  const setSelectedSkin = useGameSettingsStore((s) => s.setSelectedSkin)
  const setModelScale = useGameSettingsStore((s) => s.setModelScale)
  const setChampionHeight = useGameSettingsStore((s) => s.setChampionHeight)
  const [search, setSearch] = useState('')

  const sortedChampions = useMemo(() => {
    return CHAMPION_LIST.map((alias) => CHAMPION_CATALOG[alias])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [])

  const filteredChampions = useMemo(() => {
    if (!search.trim()) return sortedChampions
    const q = search.toLowerCase()
    return sortedChampions.filter((c) => c.name.toLowerCase().includes(q))
  }, [search, sortedChampions])

  const currentChampion = CHAMPION_CATALOG[selectedChampion]

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* Left: Champion list */}
      <div className="flex w-48 shrink-0 flex-col">
        <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-amber-500">
          Champion
        </h3>

        {/* Search */}
        <input
          type="text"
          placeholder="Rechercher..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2 rounded border border-yellow-900/30 bg-black/40 px-2 py-1.5 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-amber-500/50"
        />

        {/* Champion list */}
        <div className="flex-1 overflow-y-auto pr-1">
          {filteredChampions.map((champ) => (
            <button
              key={champ.alias}
              onClick={() => setSelectedChampion(champ.alias)}
              className={`w-full px-2 py-1.5 text-left text-sm transition-colors ${
                selectedChampion === champ.alias
                  ? 'bg-amber-500/15 font-medium text-amber-200'
                  : 'text-gray-400 hover:bg-white/[0.03] hover:text-gray-200'
              }`}
            >
              {champ.name}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Skin selection + model scale */}
      <div className="flex flex-1 flex-col">
        <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-amber-500">
          {currentChampion ? `Skins — ${currentChampion.name}` : 'Skins'}
        </h3>

        {currentChampion ? (
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-2">
              {currentChampion.skins.map((skin) => (
                <button
                  key={skin.id}
                  onClick={() => setSelectedSkin(skin.id)}
                  className={`rounded border px-3 py-2.5 text-left text-sm transition-colors ${
                    selectedSkin === skin.id
                      ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                      : 'border-yellow-900/20 bg-black/30 text-gray-400 hover:border-yellow-900/40 hover:text-gray-200'
                  }`}
                >
                  <div className="truncate font-medium">{skin.name}</div>
                  {skin.isBase && <span className="text-xs text-gray-500">Base</span>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Aucun champion selectionne</p>
        )}

        {/* Model scale slider */}
        <div className="mt-4 border-t border-yellow-900/20 pt-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wider text-amber-500">
              Taille du modele
            </label>
            <span className="text-xs text-gray-400">{modelScale.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={modelScale}
            onChange={(e) => setModelScale(parseFloat(e.target.value))}
            className="mt-1 w-full accent-amber-500"
          />
        </div>

        {/* Champion height slider */}
        <div className="mt-3 border-t border-yellow-900/20 pt-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wider text-amber-500">
              Hauteur du champion
            </label>
            <span className="text-xs text-gray-400">{championHeight}</span>
          </div>
          <input
            type="range"
            min="-500"
            max="1000"
            step="10"
            value={championHeight}
            onChange={(e) => setChampionHeight(parseFloat(e.target.value))}
            className="mt-1 w-full accent-amber-500"
          />
          <div className="mt-1 flex justify-between text-xs text-gray-500">
            <span>-500</span>
            <button
              onClick={() => setChampionHeight(150)}
              className="text-amber-600 hover:text-amber-400"
            >
              Reset (150)
            </button>
            <span>1000</span>
          </div>
        </div>
      </div>
    </div>
  )
}
