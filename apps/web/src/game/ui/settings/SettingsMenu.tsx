import { useCallback, useRef, useState } from 'react'
import HotkeysTab from './HotkeysTab'
import CameraTab from './CameraTab'
import InterfaceTab from './InterfaceTab'

const TABS = [
  { id: 'hotkeys', label: 'Raccourcis' },
  { id: 'camera', label: 'Caméra' },
  { id: 'interface', label: 'Interface' },
] as const

type TabId = (typeof TABS)[number]['id']

interface SettingsMenuProps {
  onClose: () => void
}

export default function SettingsMenu({ onClose }: SettingsMenuProps) {
  const [activeTab, setActiveTab] = useState<TabId>('hotkeys')

  // Drag state
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const panelRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true
    const panel = panelRef.current!
    const rect = panel.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    headerRef.current?.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const panel = panelRef.current
    if (!panel) return
    const pw = panel.offsetWidth
    const ph = panel.offsetHeight
    const x = Math.max(0, Math.min(window.innerWidth - pw, e.clientX - dragOffset.current.x))
    const y = Math.max(0, Math.min(window.innerHeight - ph, e.clientY - dragOffset.current.y))
    setPos({ x, y })
  }, [])

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  // When pos is null (initial), center via CSS. Once dragged, use absolute positioning.
  const panelStyle: React.CSSProperties = pos
    ? { position: 'absolute', left: pos.x, top: pos.y }
    : {}

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        ref={panelRef}
        style={panelStyle}
        className="flex h-[520px] w-[750px] flex-col rounded-lg border border-yellow-900/50 bg-[#0a0e14] shadow-2xl"
      >
        {/* Header — draggable */}
        <div
          ref={headerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="flex cursor-grab select-none items-center justify-between border-b border-yellow-900/30 px-6 py-4 active:cursor-grabbing"
        >
          <h2 className="text-lg font-semibold tracking-wide text-amber-100">PARAMETRES</h2>
          <button
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-sm text-gray-400 hover:text-white"
          >
            ESC
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex min-h-0 flex-1">
          {/* Sidebar */}
          <nav className="w-44 shrink-0 border-r border-yellow-900/30 py-3">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full px-5 py-2.5 text-left text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-r-2 border-amber-500 bg-amber-500/10 font-medium text-amber-200'
                    : 'text-gray-400 hover:bg-white/[0.03] hover:text-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'hotkeys' && <HotkeysTab />}
            {activeTab === 'camera' && <CameraTab />}
            {activeTab === 'interface' && <InterfaceTab />}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-yellow-900/30 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded bg-amber-700 px-6 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
