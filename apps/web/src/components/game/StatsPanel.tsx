import type { ChampionSnapshot } from '@template-dev/shared'

interface Props {
  player: ChampionSnapshot | null
}

export default function StatsPanel({ player }: Props) {
  if (!player) return null

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 select-none">
      <div className="pointer-events-auto rounded-lg border border-gray-700 bg-gray-900/90 px-3 py-2 text-xs text-gray-200 backdrop-blur-sm">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-bold text-yellow-400">Lv {player.level}</span>
          <span className="text-gray-400">
            {Math.floor(player.hp)}/{Math.floor(player.maxHp)} HP
          </span>
        </div>
        <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
          <Stat label="AD" value={player.ad} color="text-orange-400" />
          <Stat label="ARM" value={player.armor} color="text-yellow-500" />
          <Stat label="MR" value={player.magicResist} color="text-purple-400" />
          <Stat label="AS" value={player.attackSpeed} decimal color="text-green-400" />
          <Stat
            label="XP"
            value={player.xp}
            suffix={`/${player.xpToNextLevel || '—'}`}
            color="text-blue-400"
          />
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  color,
  decimal,
  suffix,
}: {
  label: string
  value: number
  color: string
  decimal?: boolean
  suffix?: string
}) {
  const display = decimal ? value.toFixed(2) : Math.floor(value).toString()
  return (
    <div className="flex items-center gap-1">
      <span className="text-gray-500">{label}</span>
      <span className={color}>
        {display}
        {suffix && <span className="text-gray-500">{suffix}</span>}
      </span>
    </div>
  )
}
