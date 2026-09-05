import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { CAMERA_PAN_SPEED, CHAMPION_LIST, getBaseSkinId } from '@template-dev/shared'

const DEFAULT_CHAMPION = CHAMPION_LIST.includes('ahri') ? 'ahri' : (CHAMPION_LIST[0] ?? 'default')
const DEFAULT_SKIN = getBaseSkinId(DEFAULT_CHAMPION) ?? ''

/** Ability slot index (Q=0, W=1, E=2, R=3) */
export type AbilitySlot = 0 | 1 | 2 | 3

/** Default QWERTY keybinds */
export const DEFAULT_ABILITY_KEYBINDS: Record<AbilitySlot, string> = {
  0: 'KeyQ',
  1: 'KeyW',
  2: 'KeyE',
  3: 'KeyR',
}

/** Convert a KeyboardEvent.code to a short display label */
export function keyCodeToLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  const map: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'LShift',
    ShiftRight: 'RShift',
    ControlLeft: 'LCtrl',
    ControlRight: 'RCtrl',
    AltLeft: 'LAlt',
    AltRight: 'RAlt',
    Tab: 'Tab',
    CapsLock: 'Caps',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
  }
  return map[code] ?? code
}

interface GameSettingsState {
  /** Camera scroll speed when mouse is at screen edge (world units/sec) */
  edgePanSpeed: number
  /** Camera scroll speed when using arrow keys (world units/sec) */
  keyPanSpeed: number
  /** Whether camera is locked to player (Y toggle) */
  cameraLocked: boolean
  /** Minimap scale multiplier (1 = default 180px) */
  minimapScale: number
  /** Selected champion alias (e.g. 'ahri') */
  selectedChampion: string
  /** Selected skin ID (e.g. '103000') */
  selectedSkin: string
  /** 3D model scale multiplier (1 = default, adjustable for tuning) */
  modelScale: number
  /** Y-axis rotation offset for GLB models in degrees (aligns model facing to game facing) */
  modelRotationOffset: number
  /** Champion Y-axis height offset (raises champion above map surface) */
  championHeight: number
  /** Structure (tower/nexus) scale multiplier */
  structureScale: number
  /** Ability keybinds per slot (persisted) */
  abilityKeybinds: Record<AbilitySlot, string>

  // Map debug — live-tunable
  /** Map model scale multiplier */
  mapScale: number
  /** Map rotation around Y axis in degrees */
  mapRotationY: number
  /** Map position offset X */
  mapOffsetX: number
  /** Map position offset Y (vertical) */
  mapOffsetY: number
  /** Map position offset Z */
  mapOffsetZ: number
  /** Whether to flip the map on X axis */
  mapFlipX: boolean
  /** Whether to flip the map on Z axis */
  mapFlipZ: boolean
  /** Hide towers/bushes while debugging map orientation */
  mapDebugHideStructures: boolean
  /** Hide 3D map model, show flat fallback instead */
  mapDebugHideMap: boolean
  setMapDebug: (
    key: 'mapScale' | 'mapRotationY' | 'mapOffsetX' | 'mapOffsetY' | 'mapOffsetZ',
    value: number,
  ) => void
  setMapFlip: (axis: 'mapFlipX' | 'mapFlipZ', value: boolean) => void
  setMapDebugHideStructures: (hide: boolean) => void
  setMapDebugHideMap: (hide: boolean) => void

  // Camera debug — live-tunable
  /** Pitch angle in degrees: 90 = top-down, 30 = very tilted */
  camPitch: number
  /** Yaw rotation in degrees around the target (isometric angle) */
  camYaw: number
  /** Distance from camera to target point */
  camDistance: number
  /** Field of view in degrees */
  camFov: number
  setCamDebug: (key: 'camPitch' | 'camYaw' | 'camDistance' | 'camFov', value: number) => void

  setEdgePanSpeed: (speed: number) => void
  setKeyPanSpeed: (speed: number) => void
  setCameraLocked: (locked: boolean) => void
  toggleCameraLocked: () => void
  setMinimapScale: (scale: number) => void
  setSelectedChampion: (alias: string) => void
  setSelectedSkin: (skinId: string) => void
  setModelScale: (scale: number) => void
  setModelRotationOffset: (degrees: number) => void
  setChampionHeight: (height: number) => void
  setStructureScale: (scale: number) => void
  setAbilityKeybind: (slot: AbilitySlot, keyCode: string) => void
  resetKeybinds: () => void
  resetToDefaults: () => void
}

export const useGameSettingsStore = create<GameSettingsState>()(
  persist(
    (set) => ({
      edgePanSpeed: CAMERA_PAN_SPEED,
      keyPanSpeed: CAMERA_PAN_SPEED,
      cameraLocked: false,
      minimapScale: 1,
      selectedChampion: DEFAULT_CHAMPION,
      selectedSkin: DEFAULT_SKIN,
      modelScale: 1,
      modelRotationOffset: 100,
      championHeight: 150,
      structureScale: 1,
      abilityKeybinds: { ...DEFAULT_ABILITY_KEYBINDS },

      // Map debug defaults (calibrated values)
      mapScale: 3,
      mapRotationY: 90,
      mapOffsetX: 0,
      mapOffsetY: 500,
      mapOffsetZ: -225,
      mapFlipX: false,
      mapFlipZ: false,
      mapDebugHideStructures: false,
      mapDebugHideMap: false,
      setMapDebug: (key, value) => set({ [key]: value }),
      setMapFlip: (axis, value) => set({ [axis]: value }),
      setMapDebugHideStructures: (hide) => set({ mapDebugHideStructures: hide }),
      setMapDebugHideMap: (hide) => set({ mapDebugHideMap: hide }),

      // Camera debug defaults
      camPitch: 45,
      camYaw: -90,
      camDistance: 1300,
      camFov: 60,
      setCamDebug: (key, value) => set({ [key]: value }),

      setEdgePanSpeed: (speed) => set({ edgePanSpeed: Math.max(100, Math.min(2000, speed)) }),
      setKeyPanSpeed: (speed) => set({ keyPanSpeed: Math.max(100, Math.min(2000, speed)) }),
      setCameraLocked: (locked) => set({ cameraLocked: locked }),
      toggleCameraLocked: () => set((s) => ({ cameraLocked: !s.cameraLocked })),
      setMinimapScale: (scale) => set({ minimapScale: Math.max(0.5, Math.min(2, scale)) }),
      setSelectedChampion: (alias) => {
        const skinId = getBaseSkinId(alias) ?? ''
        set({ selectedChampion: alias, selectedSkin: skinId })
      },
      setSelectedSkin: (skinId) => set({ selectedSkin: skinId }),
      setModelScale: (scale) => set({ modelScale: Math.max(0.1, Math.min(10, scale)) }),
      setModelRotationOffset: (degrees) => set({ modelRotationOffset: degrees }),
      setChampionHeight: (height) => set({ championHeight: height }),
      setStructureScale: (scale) => set({ structureScale: scale }),
      setAbilityKeybind: (slot, keyCode) =>
        set((s) => ({ abilityKeybinds: { ...s.abilityKeybinds, [slot]: keyCode } })),
      resetKeybinds: () => set({ abilityKeybinds: { ...DEFAULT_ABILITY_KEYBINDS } }),
      resetToDefaults: () =>
        set({
          edgePanSpeed: CAMERA_PAN_SPEED,
          keyPanSpeed: CAMERA_PAN_SPEED,
          cameraLocked: false,
          minimapScale: 1,
          selectedChampion: DEFAULT_CHAMPION,
          selectedSkin: DEFAULT_SKIN,
          abilityKeybinds: { ...DEFAULT_ABILITY_KEYBINDS },
        }),
    }),
    {
      name: 'game-settings',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (state: unknown) => state as GameSettingsState,
      merge: (persisted, current) => {
        const p = persisted as Partial<GameSettingsState>
        return {
          ...current,
          ...p,
          modelScale: p?.modelScale || 1,
          abilityKeybinds: p?.abilityKeybinds || { ...DEFAULT_ABILITY_KEYBINDS },
          // Reset map debug values to new defaults (v2 recalculation)
          mapScale: (current as GameSettingsState).mapScale,
          mapRotationY: (current as GameSettingsState).mapRotationY,
          mapOffsetX: (current as GameSettingsState).mapOffsetX,
          mapOffsetY: (current as GameSettingsState).mapOffsetY,
          mapOffsetZ: (current as GameSettingsState).mapOffsetZ,
          mapFlipX: (current as GameSettingsState).mapFlipX,
          mapFlipZ: (current as GameSettingsState).mapFlipZ,
        }
      },
    },
  ),
)
