const HOTKEYS = [
  { action: 'Déplacer', key: 'Clic droit' },
  { action: 'Centrer caméra (maintenir)', key: 'Espace' },
  { action: 'Verrouiller caméra (toggle)', key: 'Y' },
  { action: 'Déplacer caméra', key: '← ↑ ↓ →' },
  { action: 'Zoom', key: 'Molette' },
  { action: 'Paramètres', key: 'Echap' },
]

export default function HotkeysTab() {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium uppercase tracking-wider text-amber-500">Raccourcis</h3>

      <div className="space-y-1">
        {HOTKEYS.map(({ action, key }) => (
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
