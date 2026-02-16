import {
  MAP_WIDTH,
  MAP_HEIGHT,
  CAMERA_DEFAULT_ZOOM,
  CAMERA_MIN_ZOOM,
  CAMERA_MAX_ZOOM,
  CAMERA_ZOOM_STEP,
  CAMERA_EDGE_THRESHOLD,
  type WorldPosition,
} from '@template-dev/shared'
import type { Container } from 'pixi.js'
import { useGameSettingsStore } from '@/stores/game-settings.store'

// -45° rotation so the map goes bottom-left → top-right (like Howling Abyss)
const ROTATION = -Math.PI / 4
const INV_COS = Math.cos(-ROTATION)
const INV_SIN = Math.sin(-ROTATION)

export class Camera {
  private _x = 0
  private _y = 0
  private _zoom = CAMERA_DEFAULT_ZOOM
  private screenWidth = 0
  private screenHeight = 0
  private _locked = false

  // Edge-pan & keyboard-pan state
  private edgePanX = 0
  private edgePanY = 0
  private keyPanX = 0
  private keyPanY = 0

  // Smooth pan target (used by minimap drag)
  private panTarget: WorldPosition | null = null

  // Read pan speeds directly from Zustand store (no React middleman)
  private get edgePanSpeed(): number {
    return useGameSettingsStore.getState().edgePanSpeed
  }
  private get keyPanSpeed(): number {
    return useGameSettingsStore.getState().keyPanSpeed
  }

  constructor(private gameContainer: Container) {
    this.gameContainer.rotation = ROTATION
  }

  get x(): number {
    return this._x
  }
  get y(): number {
    return this._y
  }
  get zoom(): number {
    return this._zoom
  }
  get locked(): boolean {
    return this._locked
  }

  setScreenSize(width: number, height: number): void {
    this.screenWidth = width
    this.screenHeight = height
  }

  setLocked(locked: boolean): void {
    this._locked = locked
  }

  /** Snap camera to a world position instantly (e.g. re-center on player). */
  snapTo(target: WorldPosition): void {
    this._x = target.x
    this._y = target.y
    this.panTarget = null
    this.applyTransform()
  }

  /** Smoothly pan toward a world position (used by minimap drag). */
  panTo(target: WorldPosition): void {
    this.panTarget = { x: target.x, y: target.y }
  }

  /**
   * Called every frame. In locked mode, follow the target.
   * In free mode, apply edge-pan and key-pan.
   */
  update(dt: number, playerPos: WorldPosition): void {
    if (this._locked) {
      this._x = playerPos.x
      this._y = playerPos.y
    } else {
      // Smooth pan toward minimap target
      if (this.panTarget) {
        // Exponential lerp: ~90% of the way in ~0.1s
        const t = 1 - Math.exp(-15 * dt)
        this._x += (this.panTarget.x - this._x) * t
        this._y += (this.panTarget.y - this._y) * t

        // Snap when close enough to avoid endless tiny drifts
        const dx = this.panTarget.x - this._x
        const dy = this.panTarget.y - this._y
        if (dx * dx + dy * dy < 1) {
          this._x = this.panTarget.x
          this._y = this.panTarget.y
          this.panTarget = null
        }
      }

      const zoomInv = dt / this._zoom

      // Edge-pan contribution
      if (this.edgePanX !== 0 || this.edgePanY !== 0) {
        const s = this.edgePanSpeed * zoomInv
        const wx = this.edgePanX * INV_COS - this.edgePanY * INV_SIN
        const wy = this.edgePanX * INV_SIN + this.edgePanY * INV_COS
        this._x += wx * s
        this._y += wy * s
      }

      // Keyboard-pan contribution
      if (this.keyPanX !== 0 || this.keyPanY !== 0) {
        const s = this.keyPanSpeed * zoomInv
        const wx = this.keyPanX * INV_COS - this.keyPanY * INV_SIN
        const wy = this.keyPanX * INV_SIN + this.keyPanY * INV_COS
        this._x += wx * s
        this._y += wy * s
      }
    }
    this.applyTransform()
  }

  resetEdgePan(): void {
    this.edgePanX = 0
    this.edgePanY = 0
  }

  /** Set edge-pan direction from mouse position. */
  updateEdgePan(screenX: number, screenY: number): void {
    if (this._locked) {
      this.edgePanX = 0
      this.edgePanY = 0
      return
    }

    const t = CAMERA_EDGE_THRESHOLD
    this.edgePanX = 0
    this.edgePanY = 0

    if (screenX <= t) this.edgePanX = -1
    else if (screenX >= this.screenWidth - t) this.edgePanX = 1

    if (screenY <= t) this.edgePanY = -1
    else if (screenY >= this.screenHeight - t) this.edgePanY = 1

    // Normalize diagonal so it's not faster
    if (this.edgePanX !== 0 && this.edgePanY !== 0) {
      const inv = 1 / Math.SQRT2
      this.edgePanX *= inv
      this.edgePanY *= inv
    }
  }

  /** Set keyboard pan direction (values should be -1, 0, or 1). */
  setKeyPan(dx: number, dy: number): void {
    this.keyPanX = dx
    this.keyPanY = dy
    // Normalize diagonal
    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.SQRT2
      this.keyPanX = dx * inv
      this.keyPanY = dy * inv
    }
  }

  /** Adjust zoom by delta (positive = zoom in). */
  adjustZoom(delta: number): void {
    this._zoom = Math.max(
      CAMERA_MIN_ZOOM,
      Math.min(CAMERA_MAX_ZOOM, this._zoom + delta * CAMERA_ZOOM_STEP),
    )
    this.applyTransform()
  }

  setZoom(zoom: number): void {
    this._zoom = Math.max(CAMERA_MIN_ZOOM, Math.min(CAMERA_MAX_ZOOM, zoom))
    this.applyTransform()
  }

  /** Convert screen coordinates to world coordinates. */
  screenToWorld(screenX: number, screenY: number): WorldPosition {
    const dx = (screenX - this.screenWidth / 2) / this._zoom
    const dy = (screenY - this.screenHeight / 2) / this._zoom

    return {
      x: dx * INV_COS - dy * INV_SIN + this._x,
      y: dx * INV_SIN + dy * INV_COS + this._y,
    }
  }

  /** Apply camera transform to the game container. */
  private applyTransform(): void {
    this._x = Math.max(0, Math.min(MAP_WIDTH, this._x))
    this._y = Math.max(0, Math.min(MAP_HEIGHT, this._y))

    this.gameContainer.pivot.set(this._x, this._y)
    this.gameContainer.position.set(this.screenWidth / 2, this.screenHeight / 2)
    this.gameContainer.scale.set(this._zoom)
  }
}
