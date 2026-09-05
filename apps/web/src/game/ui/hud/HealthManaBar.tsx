interface HealthManaBarProps {
  currentHp: number
  maxHp: number
  currentMp: number
  maxMp: number
}

export default function HealthManaBar({ currentHp, maxHp, currentMp, maxMp }: HealthManaBarProps) {
  const hpPercent = maxHp > 0 ? Math.min(100, (currentHp / maxHp) * 100) : 0
  const mpPercent = maxMp > 0 ? Math.min(100, (currentMp / maxMp) * 100) : 0

  return (
    <div className="flex flex-col gap-1">
      {/* Health bar */}
      <div className="relative h-[18px] w-[280px] overflow-hidden rounded-sm border border-black/60 bg-[#333]">
        <div
          className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-100"
          style={{ width: `${hpPercent}%`, backgroundColor: '#22cc44' }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
          {Math.floor(currentHp)} / {Math.floor(maxHp)}
        </span>
      </div>

      {/* Mana bar */}
      <div className="relative h-[14px] w-[280px] overflow-hidden rounded-sm border border-black/60 bg-[#333]">
        <div
          className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-100"
          style={{ width: `${mpPercent}%`, backgroundColor: '#3388ff' }}
        />
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium tabular-nums text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
          {Math.floor(currentMp)} / {Math.floor(maxMp)}
        </span>
      </div>
    </div>
  )
}
