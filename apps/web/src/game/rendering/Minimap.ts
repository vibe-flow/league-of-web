import * as THREE from 'three'
import {
  MAP_WIDTH,
  MAP_HEIGHT,
  MINIMAP_SIZE,
  MINIMAP_PADDING,
  COLORS,
  type WorldPosition,
} from '@template-dev/shared'
import { useGameSettingsStore } from '@/stores/game-settings.store'
import type { Camera } from '../core/Camera'

// The minimap shows the map rotated -45° to match the game view.
const ROTATION = -Math.PI / 4
const INV_COS = Math.cos(-ROTATION)
const INV_SIN = Math.sin(-ROTATION)

export type MinimapClickHandler = (worldPos: WorldPosition) => void

/**
 * Minimap using a secondary orthographic camera rendering the game scene
 * to a WebGLRenderTarget, displayed as an HTML canvas overlay.
 */
export class Minimap {
  private minimapCamera: THREE.OrthographicCamera
  private renderTarget: THREE.WebGLRenderTarget
  private mainRenderer: THREE.WebGLRenderer
  private gameScene: THREE.Scene

  // HTML overlay canvas for the minimap
  private canvasEl: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  // Player dot position (in game world coords)
  private playerPos: WorldPosition = { x: 0, y: 0 }
  // Move destination (shown as line + marker on minimap)
  private moveTarget: WorldPosition | null = null

  // Camera view data
  private camX = 0
  private camY = 0
  private camViewW = 0
  private camViewH = 0
  private camZoom = 1

  // The rotated bounding box size
  private mapScale: number

  // Screen position
  private screenX = 0
  private screenY = 0
  private scaledSize = MINIMAP_SIZE

  // Callbacks for minimap interactions
  onRightClick: MinimapClickHandler | null = null
  onLeftClick: MinimapClickHandler | null = null
  onLeftDrag: MinimapClickHandler | null = null

  private leftMouseDown = false

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, _camera: Camera) {
    this.mainRenderer = renderer
    this.gameScene = scene

    // Calculate map scale for coordinate transforms
    const rotatedExtent = (MAP_WIDTH + MAP_HEIGHT) * Math.SQRT1_2
    this.mapScale = MINIMAP_SIZE / rotatedExtent

    // Setup secondary orthographic camera looking straight down at the map
    const extent = Math.max(MAP_WIDTH, MAP_HEIGHT) * 0.6
    this.minimapCamera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, 1, 5000)
    this.minimapCamera.position.set(MAP_WIDTH / 2, 3000, MAP_HEIGHT / 2)
    this.minimapCamera.up.set(0, 0, -1)
    this.minimapCamera.lookAt(MAP_WIDTH / 2, 0, MAP_HEIGHT / 2)
    this.minimapCamera.rotation.z = ROTATION

    // Render target (2x resolution for crisp minimap)
    const rtSize = MINIMAP_SIZE * 2
    this.renderTarget = new THREE.WebGLRenderTarget(rtSize, rtSize)

    // HTML canvas overlay for minimap display + UI elements
    this.canvasEl = document.createElement('canvas')
    this.canvasEl.width = rtSize
    this.canvasEl.height = rtSize
    this.canvasEl.style.position = 'absolute'
    this.canvasEl.style.borderRadius = '4px'
    this.canvasEl.style.border = '1px solid #444444'
    this.canvasEl.style.imageRendering = 'auto'
    this.ctx = this.canvasEl.getContext('2d')!
  }

  /** Render the minimap to the render target then draw to the overlay canvas. */
  render(): void {
    const renderer = this.mainRenderer

    // Save current state
    const currentRenderTarget = renderer.getRenderTarget()

    // Render scene from minimap camera
    renderer.setRenderTarget(this.renderTarget)
    renderer.render(this.gameScene, this.minimapCamera)
    renderer.setRenderTarget(currentRenderTarget)

    // Read pixels from render target and draw to canvas
    const rtSize = MINIMAP_SIZE * 2
    const pixels = new Uint8Array(rtSize * rtSize * 4)
    renderer.readRenderTargetPixels(this.renderTarget, 0, 0, rtSize, rtSize, pixels)

    // Create ImageData and draw (flip Y because WebGL reads bottom-up)
    const imageData = this.ctx.createImageData(rtSize, rtSize)
    for (let y = 0; y < rtSize; y++) {
      const srcRow = (rtSize - 1 - y) * rtSize * 4
      const dstRow = y * rtSize * 4
      for (let x = 0; x < rtSize; x++) {
        const srcIdx = srcRow + x * 4
        const dstIdx = dstRow + x * 4
        imageData.data[dstIdx] = pixels[srcIdx]
        imageData.data[dstIdx + 1] = pixels[srcIdx + 1]
        imageData.data[dstIdx + 2] = pixels[srcIdx + 2]
        imageData.data[dstIdx + 3] = pixels[srcIdx + 3]
      }
    }
    this.ctx.putImageData(imageData, 0, 0)

    // Draw overlay elements on top
    this.drawOverlays()
  }

  private drawOverlays(): void {
    const s = this.mapScale * 2 // 2x because canvas is 2x resolution
    const cx = MINIMAP_SIZE // center of canvas (in canvas pixels)
    const cy = MINIMAP_SIZE

    const pivotX = (MAP_WIDTH / 2) * s
    const pivotY = (MAP_HEIGHT / 2) * s
    const cos45 = Math.cos(ROTATION)
    const sin45 = Math.sin(ROTATION)

    // Player dot
    const px = this.playerPos.x * s
    const py = this.playerPos.y * s
    const relX = px - pivotX
    const relY = py - pivotY
    const dotX = cx + relX * cos45 - relY * sin45
    const dotY = cy + relX * sin45 + relY * cos45

    this.ctx.fillStyle = `#${COLORS.MINIMAP_PLAYER.toString(16).padStart(6, '0')}`
    this.ctx.beginPath()
    this.ctx.arc(dotX, dotY, 5, 0, Math.PI * 2)
    this.ctx.fill()

    // Move destination line + marker
    if (this.moveTarget) {
      const mx = this.moveTarget.x * s
      const my = this.moveTarget.y * s
      const mRelX = mx - pivotX
      const mRelY = my - pivotY
      const mDotX = cx + mRelX * cos45 - mRelY * sin45
      const mDotY = cy + mRelX * sin45 + mRelY * cos45

      // Line from player to destination
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
      this.ctx.lineWidth = 1.5
      this.ctx.beginPath()
      this.ctx.moveTo(dotX, dotY)
      this.ctx.lineTo(mDotX, mDotY)
      this.ctx.stroke()

      // Destination marker (small diamond)
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
      this.ctx.beginPath()
      this.ctx.moveTo(mDotX, mDotY - 4)
      this.ctx.lineTo(mDotX + 4, mDotY)
      this.ctx.lineTo(mDotX, mDotY + 4)
      this.ctx.lineTo(mDotX - 4, mDotY)
      this.ctx.closePath()
      this.ctx.fill()
    }

    // Camera viewport border
    if (this.camViewW > 0 && this.camViewH > 0) {
      const rawW = (this.camViewW / this.camZoom) * s
      const rawH = (this.camViewH / this.camZoom) * s

      const camRelX = this.camX * s - pivotX
      const camRelY = this.camY * s - pivotY
      const camCx = cx + camRelX * cos45 - camRelY * sin45
      const camCy = cy + camRelX * sin45 + camRelY * cos45

      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)'
      this.ctx.lineWidth = 1
      this.ctx.save()
      this.ctx.translate(camCx, camCy)
      this.ctx.rotate(ROTATION)
      this.ctx.strokeRect(-rawW / 2, -rawH / 2, rawW, rawH)
      this.ctx.restore()
    }
  }

  updatePlayerPosition(pos: WorldPosition): void {
    this.playerPos = pos
  }

  updateMoveTarget(pos: WorldPosition | null): void {
    this.moveTarget = pos
  }

  updateCameraView(
    cameraX: number,
    cameraY: number,
    viewWidth: number,
    viewHeight: number,
    zoom: number,
  ): void {
    this.camX = cameraX
    this.camY = cameraY
    this.camViewW = viewWidth
    this.camViewH = viewHeight
    this.camZoom = zoom
  }

  /** Position the minimap on screen (bottom-right), applying user scale. */
  positionOnScreen(screenWidth: number, screenHeight: number): void {
    const s = useGameSettingsStore.getState().minimapScale
    this.scaledSize = MINIMAP_SIZE * s
    this.screenX = screenWidth - this.scaledSize - MINIMAP_PADDING
    this.screenY = screenHeight - this.scaledSize - MINIMAP_PADDING

    this.canvasEl.style.width = `${this.scaledSize}px`
    this.canvasEl.style.height = `${this.scaledSize}px`
    this.canvasEl.style.left = `${this.screenX}px`
    this.canvasEl.style.top = `${this.screenY}px`

    // Attach to DOM if not already
    if (!this.canvasEl.parentElement) {
      const parent = this.mainRenderer.domElement.parentElement
      if (parent) {
        parent.appendChild(this.canvasEl)
      }
    }
  }

  /**
   * Convert a screen-space click position to world coordinates.
   * Reverses the minimap's rotation + scale + offset transforms.
   */
  screenToWorld(screenX: number, screenY: number): WorldPosition | null {
    const s = useGameSettingsStore.getState().minimapScale

    // 1. Screen → minimap-local
    const localX = screenX - this.screenX
    const localY = screenY - this.screenY

    // Reject if outside
    if (localX < 0 || localX > this.scaledSize || localY < 0 || localY > this.scaledSize) {
      return null
    }

    // 2. Account for container scale → unscaled local coords
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

    return {
      x: Math.max(0, Math.min(MAP_WIDTH, worldX)),
      y: Math.max(0, Math.min(MAP_HEIGHT, worldY)),
    }
  }

  containsScreenPoint(screenX: number, screenY: number): boolean {
    const localX = screenX - this.screenX
    const localY = screenY - this.screenY
    return localX >= 0 && localX <= this.scaledSize && localY >= 0 && localY <= this.scaledSize
  }

  bindInput(_canvas: HTMLCanvasElement): () => void {
    // Bind events on the minimap's own overlay canvas (not the game canvas),
    // since the minimap canvas sits on top and captures pointer events.
    const el = this.canvasEl

    const onContextMenu = (e: MouseEvent) => e.preventDefault()

    const onMouseDown = (e: MouseEvent) => {
      const worldPos = this.screenToWorld(e.clientX, e.clientY)
      if (!worldPos) return

      if (e.button === 2) {
        this.onRightClick?.(worldPos)
      } else if (e.button === 0) {
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

    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }

  destroy(): void {
    this.renderTarget.dispose()
    this.canvasEl.remove()
  }
}
