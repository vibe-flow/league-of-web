import type { AbilitySlot } from '@/stores/game-settings.store'

const SLOT_GRADIENTS: Record<AbilitySlot, string> = {
  0: 'linear-gradient(135deg, #1e3a5f 0%, #2a6bc7 100%)',
  1: 'linear-gradient(135deg, #1a4a4a 0%, #2aa5a5 100%)',
  2: 'linear-gradient(135deg, #1a4a2a 0%, #2ab55a 100%)',
  3: 'linear-gradient(135deg, #5a2a1a 0%, #d45a20 100%)',
}

interface AbilityIconProps {
  slot: AbilitySlot
  slotLabel: string
  keybindLabel: string
  cooldownRemaining: number
  cooldownTotal: number
  rank: number
  hasMana: boolean
  iconUrl?: string
}

export default function AbilityIcon({
  slot,
  slotLabel,
  keybindLabel,
  cooldownRemaining,
  cooldownTotal,
  rank,
  hasMana,
  iconUrl,
}: AbilityIconProps) {
  const onCooldown = cooldownRemaining > 0
  const notLearned = rank === 0
  const disabled = notLearned || (!hasMana && !onCooldown)

  const cooldownPercent =
    onCooldown && cooldownTotal > 0
      ? ((cooldownTotal - cooldownRemaining) / cooldownTotal) * 360
      : 360

  const displaySeconds = onCooldown ? Math.ceil(cooldownRemaining) : 0

  return (
    <div className="relative select-none" style={{ width: 52, height: 52 }}>
      {/* Ability icon image or fallback gradient */}
      {iconUrl ? (
        <img
          src={iconUrl}
          alt={slotLabel}
          className="absolute inset-0 h-full w-full rounded-md object-cover"
          style={{
            opacity: disabled || onCooldown ? 0.3 : 1,
          }}
          draggable={false}
        />
      ) : (
        <div
          className="absolute inset-0 rounded-md"
          style={{
            background: SLOT_GRADIENTS[slot],
            opacity: disabled || onCooldown ? 0.3 : 1,
          }}
        />
      )}

      {/* Border */}
      <div
        className={`absolute inset-0 rounded-md border ${
          onCooldown || disabled ? 'border-gray-600/50' : 'border-amber-500/60'
        }`}
      />

      {/* Slot letter (Q/W/E/R) centered — only when no icon */}
      {!onCooldown && !iconUrl && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold text-white/30">{slotLabel}</span>
        </div>
      )}

      {/* Cooldown sweep overlay */}
      {onCooldown && (
        <div
          className="absolute inset-0 rounded-md"
          style={{
            background: `conic-gradient(transparent ${cooldownPercent}deg, rgba(0,0,0,0.7) ${cooldownPercent}deg)`,
          }}
        />
      )}

      {/* Cooldown seconds */}
      {onCooldown && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-white drop-shadow-lg">{displaySeconds}</span>
        </div>
      )}

      {/* No mana tint */}
      {!onCooldown && !hasMana && !notLearned && (
        <div className="absolute inset-0 rounded-md bg-blue-900/40" />
      )}

      {/* Not learned overlay */}
      {notLearned && <div className="absolute inset-0 rounded-md bg-black/60" />}

      {/* Keybind label bottom-right */}
      <div className="absolute bottom-0.5 right-1">
        <span className="text-[10px] font-semibold text-amber-200/70">{keybindLabel}</span>
      </div>
    </div>
  )
}
