import { useCallback, useEffect, useState } from 'react'
import {
  useGameSettingsStore,
  keyCodeToLabel,
  DEFAULT_ABILITY_KEYBINDS,
  type AbilitySlot,
} from '@/stores/game-settings.store'

const ABILITY_SLOTS: { slot: AbilitySlot; label: string }[] = [
  { slot: 0, label: 'Sort 1 (Q)' },
  { slot: 1, label: 'Sort 2 (W)' },
  { slot: 2, label: 'Sort 3 (E)' },
  { slot: 3, label: 'Sort 4 (R)' },
]

const FIXED_HOTKEYS = [
  { action: 'Déplacer', key: 'Clic droit' },
  { action: 'Centrer caméra (maintenir)', key: 'Espace' },
  { action: 'Verrouiller caméra (toggle)', key: 'Y' },
  { action: 'Déplacer caméra', key: '← ↑ ↓ →' },
  { action: 'Zoom', key: 'Molette' },
  { action: 'Paramètres', key: 'Echap' },
]

export default function HotkeysTab() {
  const keybinds = useGameSettingsStore((s) => s.abilityKeybinds)
  const setAbilityKeybind = useGameSettingsStore((s) => s.setAbilityKeybind)
  const resetKeybinds = useGameSettingsStore((s) => s.resetKeybinds)

  // Which slot is currently listening for a new key (null = none)
  const [editingSlot, setEditingSlot] = useState<AbilitySlot | null>(null)

  const handleKeyCapture = useCallback(
    (e: KeyboardEvent) => {
      if (editingSlot === null) return
      e.preventDefault()
      e.stopPropagation()

      // Ignore modifier-only presses and Escape (cancels editing)
      if (e.code === 'Escape') {
        setEditingSlot(null)
        return
      }
      if (
        [
          'ShiftLeft',
          'ShiftRight',
          'ControlLeft',
          'ControlRight',
          'AltLeft',
          'AltRight',
          'MetaLeft',
          'MetaRight',
        ].includes(e.code)
      ) {
        return
      }

      setAbilityKeybind(editingSlot, e.code)
      setEditingSlot(null)
    },
    [editingSlot, setAbilityKeybind],
  )

  useEffect(() => {
    if (editingSlot === null) return
    window.addEventListener('keydown', handleKeyCapture, true)
    return () => window.removeEventListener('keydown', handleKeyCapture, true)
  }, [editingSlot, handleKeyCapture])

  return (
    <div className="space-y-4">
      {/* Ability keybinds — editable */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium uppercase tracking-wider text-amber-500">Sorts</h3>
        <button onClick={resetKeybinds} className="text-[11px] text-gray-500 hover:text-amber-400">
          Réinitialiser
        </button>
      </div>

      <div className="space-y-1">
        {ABILITY_SLOTS.map(({ slot, label }) => {
          const isEditing = editingSlot === slot
          const currentKey = keybinds[slot]
          const isDefault = currentKey === DEFAULT_ABILITY_KEYBINDS[slot]

          return (
            <div
              key={slot}
              className="flex items-center justify-between rounded px-3 py-2 odd:bg-white/[0.03]"
            >
              <span className="text-sm text-gray-300">{label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingSlot(isEditing ? null : slot)
                }}
                className={`min-w-[56px] rounded border px-2.5 py-1 text-center text-xs font-medium transition-colors ${
                  isEditing
                    ? 'animate-pulse border-amber-500 bg-amber-500/20 text-amber-100'
                    : isDefault
                      ? 'border-yellow-900/40 bg-yellow-900/20 text-amber-200 hover:border-amber-500/50'
                      : 'border-amber-600/50 bg-amber-600/15 text-amber-100 hover:border-amber-500/50'
                }`}
              >
                {isEditing ? '...' : keyCodeToLabel(currentKey)}
              </button>
            </div>
          )
        })}
      </div>

      {/* Fixed hotkeys — read-only */}
      <h3 className="text-sm font-medium uppercase tracking-wider text-amber-500">Autres</h3>

      <div className="space-y-1">
        {FIXED_HOTKEYS.map(({ action, key }) => (
          <div
            key={action}
            className="flex items-center justify-between rounded px-3 py-2 odd:bg-white/[0.03]"
          >
            <span className="text-sm text-gray-300">{action}</span>
            <kbd className="rounded border border-yellow-900/40 bg-yellow-900/20 px-2.5 py-1 text-xs font-medium text-amber-200">
              {key}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  )
}
