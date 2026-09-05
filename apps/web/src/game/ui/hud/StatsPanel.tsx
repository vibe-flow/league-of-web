import type { BaseStats } from '@template-dev/shared'

const STAT_DEFS = [
  { key: 'ad' as keyof BaseStats, label: 'AD', color: 'text-orange-400' },
  { key: 'ap' as keyof BaseStats, label: 'AP', color: 'text-purple-400' },
  { key: 'armor' as keyof BaseStats, label: 'ARM', color: 'text-yellow-400' },
  { key: 'magicResist' as keyof BaseStats, label: 'MR', color: 'text-blue-400' },
  { key: 'attackSpeed' as keyof BaseStats, label: 'AS', color: 'text-green-400' },
]

interface StatsPanelProps {
  stats: BaseStats
}

export default function StatsPanel({ stats }: StatsPanelProps) {
  return (
    <div className="flex gap-3">
      {STAT_DEFS.map(({ key, label, color }) => {
        const value = stats[key]
        const display = key === 'attackSpeed' ? value.toFixed(2) : Math.floor(value)
        return (
          <div key={key} className="flex items-center gap-0.5">
            <span className={`text-[10px] font-semibold ${color}`}>{label}</span>
            <span className="text-[10px] tabular-nums text-gray-300">{display}</span>
          </div>
        )
      })}
    </div>
  )
}
