import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { CAMERA_PAN_SPEED } from '@template-dev/shared'

interface GameSettingsState {
  /** Camera scroll speed when mouse is at screen edge (world units/sec) */
  edgePanSpeed: number
  /** Camera scroll speed when using arrow keys (world units/sec) */
  keyPanSpeed: number
  /** Whether camera is locked to player (Y toggle) */
  cameraLocked: boolean
  /** Minimap scale multiplier (1 = default 180px) */
  minimapScale: number

  setEdgePanSpeed: (speed: number) => void
  setKeyPanSpeed: (speed: number) => void
  setCameraLocked: (locked: boolean) => void
  toggleCameraLocked: () => void
  setMinimapScale: (scale: number) => void
  resetToDefaults: () => void
}

export const useGameSettingsStore = create<GameSettingsState>()(
  persist(
    (set) => ({
      edgePanSpeed: CAMERA_PAN_SPEED,
      keyPanSpeed: CAMERA_PAN_SPEED,
      cameraLocked: false,
      minimapScale: 1,

      setEdgePanSpeed: (speed) => set({ edgePanSpeed: Math.max(100, Math.min(2000, speed)) }),
      setKeyPanSpeed: (speed) => set({ keyPanSpeed: Math.max(100, Math.min(2000, speed)) }),
      setCameraLocked: (locked) => set({ cameraLocked: locked }),
      toggleCameraLocked: () => set((s) => ({ cameraLocked: !s.cameraLocked })),
      setMinimapScale: (scale) => set({ minimapScale: Math.max(0.5, Math.min(2, scale)) }),
      resetToDefaults: () =>
        set({
          edgePanSpeed: CAMERA_PAN_SPEED,
          keyPanSpeed: CAMERA_PAN_SPEED,
          cameraLocked: false,
          minimapScale: 1,
        }),
    }),
    {
      name: 'game-settings',
      storage: createJSONStorage(() => localStorage),
    },
  ),
)
