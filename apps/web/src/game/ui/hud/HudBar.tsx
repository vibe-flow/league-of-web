import { useHudStore, ABILITY_SLOT_LABELS, PLACEHOLDER_MANA_COSTS } from '@/stores/hud.store'
import {
  useGameSettingsStore,
  keyCodeToLabel,
  type AbilitySlot,
} from '@/stores/game-settings.store'
import AbilityIcon from './AbilityIcon'
import HealthManaBar from './HealthManaBar'
import StatsPanel from './StatsPanel'
import ChampionPortrait from './ChampionPortrait'

const SLOTS: AbilitySlot[] = [0, 1, 2, 3]

export default function HudBar() {
  const currentHp = useHudStore((s) => s.currentHp)
  const maxHp = useHudStore((s) => s.maxHp)
  const currentMp = useHudStore((s) => s.currentMp)
  const maxMp = useHudStore((s) => s.maxMp)
  const level = useHudStore((s) => s.level)
  const stats = useHudStore((s) => s.stats)
  const abilities = useHudStore((s) => s.abilities)
  const championId = useHudStore((s) => s.championId)
  const championName = useHudStore((s) => s.championName)
  const abilityIcons = useHudStore((s) => s.abilityIcons)
  const keybinds = useGameSettingsStore((s) => s.abilityKeybinds)

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-yellow-900/40 bg-[#0a0e14]/90 px-4 py-3 shadow-2xl backdrop-blur-sm">
        {/* Champion portrait */}
        <ChampionPortrait championId={championId} championName={championName} level={level} />

        {/* Health / Mana / Stats */}
        <div className="flex flex-col gap-1">
          <HealthManaBar currentHp={currentHp} maxHp={maxHp} currentMp={currentMp} maxMp={maxMp} />
          <StatsPanel stats={stats} />
        </div>

        {/* Separator */}
        <div className="mx-1 h-14 w-px bg-yellow-900/30" />

        {/* Ability icons */}
        <div className="flex items-center gap-1">
          {SLOTS.map((slot) => (
            <AbilityIcon
              key={slot}
              slot={slot}
              slotLabel={ABILITY_SLOT_LABELS[slot]}
              keybindLabel={keyCodeToLabel(keybinds[slot])}
              cooldownRemaining={abilities[slot].cooldownRemaining}
              cooldownTotal={abilities[slot].cooldownTotal}
              rank={abilities[slot].rank}
              hasMana={currentMp >= PLACEHOLDER_MANA_COSTS[slot]}
              iconUrl={abilityIcons[slot] || undefined}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
