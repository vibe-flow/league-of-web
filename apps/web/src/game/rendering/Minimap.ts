import { Container, Graphics } from 'pixi.js'
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  MINIMAP_SIZE,
  MINIMAP_PADDING,
  NEXUS_RADIUS,
  ARAM_MAP,
  COLORS,
  type WorldPosition,
} from '@template-dev/shared'
import { useGameSettingsStore } from '@/stores/game-settings.store'

// The minimap shows the map rotated -45° to match the game view.
// We draw a rotated inner container inside a square minimap.
const ROTATION = -Math.PI / 4
const INV_COS = Math.cos(-ROTATION)
const INV_SIN = Math.sin(-ROTATION)

export type MinimapClickHandler = (worldPos: WorldPosition) => void

export class Minimap {
  readonly container = new Container()
  private playerDot: Graphics
  private pathLine: Graphics
  private cameraBorder: Graphics
  private mapContent: Container

  // Scale to fit the rotated map inside the minimap square.
  // The diagonal of the map rotated 45° has a bounding box of:
  // width ≈ (MAP_WIDTH + MAP_HEIGHT) * cos(45°), height ≈ same
  private mapScale: number

  // Callbacks for minimap interactions
  onRightClick: MinimapClickHandler | null = null
  onLeftClick: MinimapClickHandler | null = null
  onLeftDrag: MinimapClickHandler | null = null

  private leftMouseDown = false

  constructor() {
    this.container.label = 'minimap'

    // The rotated bounding box size
    const rotatedExtent = (MAP_WIDTH + MAP_HEIGHT) * Math.SQRT1_2
    this.mapScale = MINIMAP_SIZE / rotatedExtent

    // Mask to clip
    const mask = new Graphics()
    mask.roundRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE, 4)
    mask.fill(0xffffff)
    this.container.addChild(mask)
    this.container.mask = mask

    // Background
    const bg = new Graphics()
    bg.roundRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE, 4)
    bg.fill(COLORS.MINIMAP_BG)
    this.container.addChild(bg)

    // Rotated map content container
    this.mapContent = new Container()
    this.mapContent.rotation = ROTATION
    // Position so the rotated map is centered in the minimap square
    this.mapContent.x = MINIMAP_SIZE / 2
    this.mapContent.y = MINIMAP_SIZE / 2
    this.mapContent.pivot.set((MAP_WIDTH / 2) * this.mapScale, (MAP_HEIGHT / 2) * this.mapScale)
    this.container.addChild(this.mapContent)

    // Lane area inside the rotated container
    const lane = new Graphics()
    lane.rect(0, 0, MAP_WIDTH * this.mapScale, MAP_HEIGHT * this.mapScale)
    lane.fill({ color: COLORS.MINIMAP_LANE, alpha: 0.4 })
    this.mapContent.addChild(lane)

    // Structures
    const structures = new Graphics()
    for (const obs of ARAM_MAP.circleObstacles) {
      const isBlue = obs.center.x < MAP_WIDTH / 2
      const isNexus = obs.radius >= NEXUS_RADIUS
      const mx = obs.center.x * this.mapScale
      const my = obs.center.y * this.mapScale
      const mr = Math.max(2, obs.radius * this.mapScale)
      structures.circle(mx, my, mr)
      if (isNexus) {
        structures.fill(isBlue ? COLORS.NEXUS_BLUE : COLORS.NEXUS_RED)
      } else {
        structures.fill(isBlue ? COLORS.TURRET_BLUE : COLORS.TURRET_RED)
      }
    }
    this.mapContent.addChild(structures)

    // Path line (drawn below player dot)
    this.pathLine = new Graphics()
    this.mapContent.addChild(this.pathLine)

    // Camera viewport border
    this.cameraBorder = new Graphics()
    this.mapContent.addChild(this.cameraBorder)

    // Player dot
    this.playerDot = new Graphics()
    this.playerDot.circle(0, 0, 3)
    this.playerDot.fill(COLORS.MINIMAP_PLAYER)
    this.mapContent.addChild(this.playerDot)

    // Border on top of the whole minimap
    const border = new Graphics()
    border.roundRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE, 4)
    border.stroke({ width: 1, color: 0x444444 })
    this.container.addChild(border)
  }

  updatePlayerPosition(pos: WorldPosition): void {
    this.playerDot.x = pos.x * this.mapScale
    this.playerDot.y = pos.y * this.mapScale
  }

  updatePath(playerPos: WorldPosition, waypoints: readonly WorldPosition[]): void {
    this.pathLine.clear()
    if (waypoints.length === 0) return

    const s = this.mapScale
    this.pathLine.moveTo(playerPos.x * s, playerPos.y * s)
    for (const wp of waypoints) {
      this.pathLine.lineTo(wp.x * s, wp.y * s)
    }
    this.pathLine.stroke({ width: 1, color: COLORS.MINIMAP_PLAYER, alpha: 0.6 })
  }

  updateCameraView(
    cameraX: number,
    cameraY: number,
    viewWidth: number,
    viewHeight: number,
    zoom: number,
  ): void {
    // The camera view in world space is a rectangle, but when shown on the
    // rotated minimap it's simpler to just show a circle/dot for the viewport center.
    // For now, draw a simple rectangle in world-space minimap coords.
    const s = this.mapScale
    const rawW = (viewWidth / zoom) * s
    const rawH = (viewHeight / zoom) * s
    const rawX = cameraX * s - rawW / 2
    const rawY = cameraY * s - rawH / 2

    this.cameraBorder.clear()
    if (rawW > 0 && rawH > 0) {
      this.cameraBorder.rect(rawX, rawY, rawW, rawH)
      this.cameraBorder.stroke({ width: 1, color: 0xffffff, alpha: 0.5 })
    }
  }

  /** Position the minimap in screen space (bottom-right), applying user scale. */
  positionOnScreen(screenWidth: number, screenHeight: number): void {
    const s = useGameSettingsStore.getState().minimapScale
    this.container.scale.set(s)
    const scaledSize = MINIMAP_SIZE * s
    this.container.x = screenWidth - scaledSize - MINIMAP_PADDING
    this.container.y = screenHeight - scaledSize - MINIMAP_PADDING
  }

  /**
   * Convert a screen-space click position to world coordinates.
   * Reverses the minimap's rotation + scale + offset transforms.
   */
  screenToWorld(screenX: number, screenY: number): WorldPosition | null {
    const s = useGameSettingsStore.getState().minimapScale
    const scaledSize = MINIMAP_SIZE * s

    // 1. Screen → minimap-local (relative to minimap container top-left)
    const localX = screenX - this.container.x
    const localY = screenY - this.container.y

    // Reject if outside the scaled minimap square
    if (localX < 0 || localX > scaledSize || localY < 0 || localY > scaledSize) {
      return null
    }

    // 2. Account for container scale — convert to unscaled local coords
    const unscaledX = localX / s
    const unscaledY = localY / s

    // 3. Minimap-local → rotated-map-space
    const cx = unscaledX - MINIMAP_SIZE / 2
    const cy = unscaledY - MINIMAP_SIZE / 2

    // Undo the -45° rotation (apply +45°)
    const mapLocalX = cx * INV_COS - cy * INV_SIN
    const mapLocalY = cx * INV_SIN + cy * INV_COS

    // Add back the pivot (map center in minimap-scaled coords)
    const scaledX = mapLocalX + (MAP_WIDTH / 2) * this.mapScale
    const scaledY = mapLocalY + (MAP_HEIGHT / 2) * this.mapScale

    // 4. Minimap-scaled → world
    const worldX = scaledX / this.mapScale
    const worldY = scaledY / this.mapScale

    // Clamp to map bounds
    return {
      x: Math.max(0, Math.min(MAP_WIDTH, worldX)),
      y: Math.max(0, Math.min(MAP_HEIGHT, worldY)),
    }
  }

  /**
   * Check if a screen-space point is inside the minimap bounds.
   */
  containsScreenPoint(screenX: number, screenY: number): boolean {
    const scaledSize = MINIMAP_SIZE * useGameSettingsStore.getState().minimapScale
    const localX = screenX - this.container.x
    const localY = screenY - this.container.y
    return localX >= 0 && localX <= scaledSize && localY >= 0 && localY <= scaledSize
  }

  /**
   * Bind mouse events on the canvas for minimap interactions.
   * Returns a cleanup function to remove listeners.
   */
  destroy(): void {
    this.container.destroy({ children: true })
  }

  bindInput(canvas: HTMLCanvasElement): () => void {
    const onMouseDown = (e: MouseEvent) => {
      if (!this.containsScreenPoint(e.clientX, e.clientY)) return

      const worldPos = this.screenToWorld(e.clientX, e.clientY)
      if (!worldPos) return

      if (e.button === 2) {
        // Right-click → move command
        this.onRightClick?.(worldPos)
      } else if (e.button === 0) {
        // Left-click → camera pan
        this.leftMouseDown = true
        this.onLeftClick?.(worldPos)
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!this.leftMouseDown) return
      const worldPos = this.screenToWorld(e.clientX, e.clientY)
      if (!worldPos) return
      this.onLeftDrag?.(worldPos)
    }

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        this.leftMouseDown = false
      }
    }

    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }
}
