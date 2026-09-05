import * as THREE from 'three'
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
import { useGameSettingsStore } from '@/stores/game-settings.store'

// -45° rotation so the map goes bottom-left → top-right (like Howling Abyss)
const ROTATION = -Math.PI / 4
const INV_COS = Math.cos(-ROTATION)
const INV_SIN = Math.sin(-ROTATION)

const DEG2RAD = Math.PI / 180

export class Camera {
  readonly threeCamera: THREE.PerspectiveCamera

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

  // Raycaster for screenToWorld
  private raycaster = new THREE.Raycaster()
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private _ndcVec = new THREE.Vector2()
  private _intersectTarget = new THREE.Vector3()

  // Read pan speeds directly from Zustand store (no React middleman)
  private get edgePanSpeed(): number {
    return useGameSettingsStore.getState().edgePanSpeed
  }
  private get keyPanSpeed(): number {
    return useGameSettingsStore.getState().keyPanSpeed
  }

  constructor(screenWidth: number, screenHeight: number) {
    this.screenWidth = screenWidth
    this.screenHeight = screenHeight

    const s = useGameSettingsStore.getState()
    this.threeCamera = new THREE.PerspectiveCamera(s.camFov, screenWidth / screenHeight, 10, 20000)

    this.threeCamera.position.set(0, s.camDistance, 0)
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
    this.threeCamera.aspect = width / height
    this.threeCamera.updateProjectionMatrix()
    this.applyTransform()
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
        const t = 1 - Math.exp(-15 * dt)
        this._x += (this.panTarget.x - this._x) * t
        this._y += (this.panTarget.y - this._y) * t

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

  /** Convert screen coordinates to world coordinates via ray-plane intersection. */
  screenToWorld(screenX: number, screenY: number): WorldPosition {
    // Convert screen coords to NDC (-1 to +1)
    const ndcX = (screenX / this.screenWidth) * 2 - 1
    const ndcY = -(screenY / this.screenHeight) * 2 + 1

    // Cast ray from camera through the NDC point
    this._ndcVec.set(ndcX, ndcY)
    this.raycaster.setFromCamera(this._ndcVec, this.threeCamera)

    // Intersect with Y=0 ground plane
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this._intersectTarget)

    if (hit) {
      return { x: this._intersectTarget.x, y: this._intersectTarget.z }
    }

    // Fallback (shouldn't happen with pitch > 0)
    return { x: this._x, y: this._y }
  }

  /**
   * Apply camera transform using lookAt.
   *
   * The camera orbits around the target point (this._x, 0, this._y) like a
   * spherical coordinate system:
   *   - camPitch: elevation angle in degrees (90 = straight above, 0 = ground level)
   *   - camYaw: horizontal angle in degrees (controls which direction is "forward")
   *   - camDistance: how far the camera is from the target
   *
   * The camera always looks at the target point via lookAt().
   */
  private applyTransform(): void {
    this._x = Math.max(0, Math.min(MAP_WIDTH, this._x))
    this._y = Math.max(0, Math.min(MAP_HEIGHT, this._y))

    const s = useGameSettingsStore.getState()
    const dist = s.camDistance / this._zoom

    // Spherical → Cartesian offset from target
    // pitch=90° → camera straight above (sin(90)=1 → all height, no horizontal offset)
    // pitch=45° → 45° angle, equal height and horizontal offset
    const pitchRad = s.camPitch * DEG2RAD
    const yawRad = s.camYaw * DEG2RAD

    const horizontalDist = dist * Math.cos(pitchRad)
    const height = dist * Math.sin(pitchRad)

    // Yaw determines which direction "behind" is in the XZ plane
    // In Three.js: X is right, Z is "forward" (toward camera's default view)
    const offsetX = horizontalDist * Math.sin(yawRad)
    const offsetZ = horizontalDist * Math.cos(yawRad)

    // Target point on the ground (game coords → Three.js)
    const targetX = this._x
    const targetZ = this._y

    // Position camera at orbit point
    this.threeCamera.position.set(targetX + offsetX, height, targetZ + offsetZ)

    // Look slightly ahead of the target along the camera's forward direction
    // This shifts the visual center so the champion appears in the lower third
    // (like LoL), rather than dead center, giving more visibility ahead.
    const lookAheadDist = dist * 0.15
    const lookAheadX = -lookAheadDist * Math.sin(yawRad)
    const lookAheadZ = -lookAheadDist * Math.cos(yawRad)
    this.threeCamera.lookAt(targetX + lookAheadX, 0, targetZ + lookAheadZ)

    // FOV
    if (this.threeCamera.fov !== s.camFov) {
      this.threeCamera.fov = s.camFov
      this.threeCamera.updateProjectionMatrix()
    }
  }
}
