import { Application, Container } from 'pixi.js'
import {
  ARAM_MAP,
  BLUE_SPAWN,
  DEFAULT_MOVE_SPEED,
  DEFAULT_HP,
  DEFAULT_MAX_HP,
  WAYPOINT_REACH_THRESHOLD,
  COLORS,
  type WorldPosition,
} from '@template-dev/shared'
import { NavigationGrid, findPath, hasLineOfSight } from '../pathfinding'
import { useGameSettingsStore } from '@/stores/game-settings.store'
import { Camera } from './Camera'
import { MapRenderer } from '../rendering/MapRenderer'
import { ChampionRenderer } from '../rendering/ChampionRenderer'
import { HealthBar } from '../rendering/HealthBar'
import { MoveIndicator } from '../rendering/MoveIndicator'
import { Minimap } from '../rendering/Minimap'

export class Game {
  private app: Application
  private gameContainer!: Container
  private uiContainer!: Container

  private camera!: Camera
  private mapRenderer!: MapRenderer
  private championRenderer!: ChampionRenderer
  private healthBar!: HealthBar
  private moveIndicator!: MoveIndicator
  private minimap!: Minimap
  private grid!: NavigationGrid

  // Player state
  private playerPos: WorldPosition = { ...BLUE_SPAWN }
  private playerHP = DEFAULT_HP
  private playerMaxHP = DEFAULT_MAX_HP
  private waypoints: WorldPosition[] = []
  private moveTarget: WorldPosition | null = null // final destination for facing

  private destroyed = false
  private _paused = false
  private rightMouseDown = false
  private lastMoveCommandTime = 0
  private static readonly MOVE_THROTTLE_MS = 50 // recalc path at most every 50ms

  // Camera pan keys state
  private keysDown = new Set<string>()
  private spaceDown = false

  // Callback to notify React of pause state changes
  onPauseChange: ((paused: boolean) => void) | null = null

  // Store references for cleanup
  private onResize: (() => void) | null = null
  private onContextMenu: ((e: MouseEvent) => void) | null = null
  private onMouseDown: ((e: MouseEvent) => void) | null = null
  private onMouseMove: ((e: MouseEvent) => void) | null = null
  private onMouseUp: ((e: MouseEvent) => void) | null = null
  private onWheel: ((e: WheelEvent) => void) | null = null
  private onSelectStart: ((e: Event) => void) | null = null
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null
  private onKeyUp: ((e: KeyboardEvent) => void) | null = null
  private cleanupMinimapInput: (() => void) | null = null
  private canvas: HTMLCanvasElement | null = null

  get paused(): boolean {
    return this._paused
  }

  setPaused(paused: boolean): void {
    this._paused = paused
    // Reset all input state to avoid stale state after un-pause
    this.rightMouseDown = false
    this.keysDown.clear()
    this.spaceDown = false
    if (this.camera) {
      // Restore Y toggle state instead of forcing unlock
      this.camera.setLocked(useGameSettingsStore.getState().cameraLocked)
      this.camera.setKeyPan(0, 0)
      this.camera.resetEdgePan()
    }
  }

  constructor() {
    this.app = new Application()
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas
    const w = window.innerWidth
    const h = window.innerHeight

    await this.app.init({
      canvas,
      width: w,
      height: h,
      backgroundColor: 0x111111,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })

    // Containers
    this.gameContainer = new Container()
    this.gameContainer.label = 'game-world'
    this.app.stage.addChild(this.gameContainer)

    this.uiContainer = new Container()
    this.uiContainer.label = 'ui'
    this.app.stage.addChild(this.uiContainer)

    // Navigation grid
    this.grid = new NavigationGrid(ARAM_MAP)

    // Camera
    this.camera = new Camera(this.gameContainer)
    this.camera.setScreenSize(w, h)
    this.camera.setZoom(0.8)

    // Map
    this.mapRenderer = new MapRenderer()
    this.mapRenderer.build()
    this.gameContainer.addChild(this.mapRenderer.container)

    // Move indicator
    this.moveIndicator = new MoveIndicator()
    this.gameContainer.addChild(this.moveIndicator.graphics)

    // Champion
    this.championRenderer = new ChampionRenderer(COLORS.CHAMPION_BLUE)
    this.championRenderer.setPosition(this.playerPos)
    this.gameContainer.addChild(this.championRenderer.container)

    // Health bar (child of champion so it moves with it)
    this.healthBar = new HealthBar()
    this.championRenderer.container.addChild(this.healthBar.container)

    // Minimap (in UI layer, not affected by game camera)
    this.minimap = new Minimap()
    this.minimap.positionOnScreen(w, h)
    this.uiContainer.addChild(this.minimap.container)

    // Input
    this.bindInput(canvas)
    this.bindMinimapInput(canvas)

    // Resize handler
    this.onResize = () => {
      if (this.destroyed) return
      const nw = window.innerWidth
      const nh = window.innerHeight
      this.app.renderer.resize(nw, nh)
      this.camera.setScreenSize(nw, nh)
      this.minimap.positionOnScreen(nw, nh)
      this.camera.snapTo(this.playerPos)
    }
    window.addEventListener('resize', this.onResize)

    // Game loop
    this.app.ticker.add((ticker) => {
      if (this.destroyed) return
      const dt = ticker.deltaMS / 1000 // seconds
      this.update(dt)
    })

    // Initial camera position
    this.camera.snapTo(this.playerPos)
  }

  // ===========================================================================
  // Input
  // ===========================================================================

  private issueMoveCommand(screenX: number, screenY: number): void {
    const now = performance.now()
    if (now - this.lastMoveCommandTime < Game.MOVE_THROTTLE_MS) return
    this.lastMoveCommandTime = now

    const worldPos = this.camera.screenToWorld(screenX, screenY)
    this.issueMoveToWorld(worldPos)
  }

  /** Issue a move command to a world position (shared by canvas click & minimap). */
  private issueMoveToWorld(worldPos: WorldPosition): void {
    // If direct line of sight exists, go straight — avoids grid-snapping jitter
    const fromGrid = this.grid.worldToGrid(this.playerPos)
    const toGrid = this.grid.worldToGrid(worldPos)
    if (hasLineOfSight(this.grid, fromGrid, toGrid)) {
      this.waypoints = [worldPos]
      this.moveTarget = worldPos
      this.moveIndicator.show(worldPos)
      return
    }

    const path = findPath(this.grid, this.playerPos, worldPos)
    if (path && path.length > 0) {
      this.waypoints = path
      this.moveTarget = worldPos
      // Skip the first waypoint if it's essentially the current position
      if (this.waypoints.length > 1) {
        const first = this.waypoints[0]
        const dx = first.x - this.playerPos.x
        const dy = first.y - this.playerPos.y
        if (dx * dx + dy * dy < 100) {
          this.waypoints.shift()
        }
      }
      this.moveIndicator.show(worldPos)
    } else {
      // Pathfinding failed — clear any stale move state
      this.waypoints = []
      this.moveTarget = null
    }
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    // Prevent default context menu
    this.onContextMenu = (e: MouseEvent) => e.preventDefault()
    canvas.addEventListener('contextmenu', this.onContextMenu)

    // Right mouse button down → start move + track (ignore if on minimap)
    this.onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2 || this.destroyed || this._paused) return
      if (this.minimap.containsScreenPoint(e.clientX, e.clientY)) return
      this.rightMouseDown = true
      this.lastMoveCommandTime = 0 // reset throttle for immediate response
      this.issueMoveCommand(e.clientX, e.clientY)
    }
    canvas.addEventListener('mousedown', this.onMouseDown)

    // Mouse move → update destination if right-click held + edge-pan camera
    // Bound to window (not canvas) so it works even after overlay closes
    this.onMouseMove = (e: MouseEvent) => {
      if (this.destroyed || this._paused) return
      this.camera.updateEdgePan(e.clientX, e.clientY)
      if (this.rightMouseDown) {
        this.issueMoveCommand(e.clientX, e.clientY)
      }
    }
    window.addEventListener('mousemove', this.onMouseMove)

    // Right mouse button up → stop tracking
    this.onMouseUp = (e: MouseEvent) => {
      if (e.button !== 2) return
      this.rightMouseDown = false
    }
    window.addEventListener('mouseup', this.onMouseUp)

    this.onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (this.destroyed) return
      const delta = e.deltaY > 0 ? -1 : 1
      this.camera.adjustZoom(delta)
    }
    canvas.addEventListener('wheel', this.onWheel, { passive: false })

    this.onSelectStart = (e: Event) => e.preventDefault()
    canvas.addEventListener('selectstart', this.onSelectStart)

    // Keyboard: escape for settings, arrow keys for pan, space for lock/center
    this.onKeyDown = (e: KeyboardEvent) => {
      if (this.destroyed) return
      const key = e.code

      if (key === 'Escape') {
        const next = !this._paused
        this.setPaused(next)
        this.onPauseChange?.(next)
        return
      }

      if (this._paused) return

      if (key === 'Space') {
        e.preventDefault()
        if (!this.spaceDown) {
          this.spaceDown = true
          this.camera.snapTo(this.playerPos)
          this.camera.setLocked(true)
        }
        return
      }

      if (key === 'KeyY') {
        e.preventDefault()
        useGameSettingsStore.getState().toggleCameraLocked()
        const locked = useGameSettingsStore.getState().cameraLocked
        this.camera.setLocked(locked)
        if (locked) this.camera.snapTo(this.playerPos)
        return
      }

      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        e.preventDefault()
        this.keysDown.add(key)
        this.updateKeyPan()
      }
    }
    window.addEventListener('keydown', this.onKeyDown)

    this.onKeyUp = (e: KeyboardEvent) => {
      if (this.destroyed) return
      const key = e.code

      if (key === 'Space') {
        this.spaceDown = false
        // Restore Y toggle state instead of always unlocking
        const yLocked = useGameSettingsStore.getState().cameraLocked
        this.camera.setLocked(yLocked)
        return
      }

      if (this.keysDown.delete(key)) {
        this.updateKeyPan()
      }
    }
    window.addEventListener('keyup', this.onKeyUp)
  }

  private updateKeyPan(): void {
    let dx = 0
    let dy = 0
    if (this.keysDown.has('ArrowLeft')) dx -= 1
    if (this.keysDown.has('ArrowRight')) dx += 1
    if (this.keysDown.has('ArrowUp')) dy -= 1
    if (this.keysDown.has('ArrowDown')) dy += 1
    this.camera.setKeyPan(dx, dy)
  }

  private bindMinimapInput(canvas: HTMLCanvasElement): void {
    // Right-click on minimap → move champion to that world position
    this.minimap.onRightClick = (worldPos) => {
      if (this.destroyed || this._paused) return
      this.lastMoveCommandTime = 0
      this.issueMoveToWorld(worldPos)
    }

    // Left-click on minimap → pan camera smoothly to that world position
    this.minimap.onLeftClick = (worldPos) => {
      if (this.destroyed || this._paused) return
      this.camera.panTo(worldPos)
    }

    // Left-drag on minimap → continuously pan camera (smooth)
    this.minimap.onLeftDrag = (worldPos) => {
      if (this.destroyed || this._paused) return
      this.camera.panTo(worldPos)
    }

    this.cleanupMinimapInput = this.minimap.bindInput(canvas)
  }

  // ===========================================================================
  // Update loop
  // ===========================================================================

  private update(dt: number): void {
    this.updateMovement(dt)
    this.moveIndicator.update(dt)
    this.camera.update(dt, this.playerPos)

    // Update visual positions
    this.championRenderer.setPosition(this.playerPos)
    this.healthBar.update(this.playerHP / this.playerMaxHP)

    // Minimap (reposition every frame to pick up scale changes from settings)
    this.minimap.positionOnScreen(this.app.screen.width, this.app.screen.height)
    this.minimap.updatePlayerPosition(this.playerPos)
    this.minimap.updatePath(this.playerPos, this.waypoints)
    this.minimap.updateCameraView(
      this.camera.x,
      this.camera.y,
      this.app.screen.width,
      this.app.screen.height,
      this.camera.zoom,
    )
  }

  private updateMovement(dt: number): void {
    if (this.waypoints.length === 0) return

    const target = this.waypoints[0]
    const dx = target.x - this.playerPos.x
    const dy = target.y - this.playerPos.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < WAYPOINT_REACH_THRESHOLD) {
      this.waypoints.shift()
      if (this.waypoints.length === 0) {
        this.moveTarget = null
        return
      }
      return
    }

    // Update facing direction — use final destination for stable orientation
    const facingRef = this.moveTarget ?? target
    const fdx = facingRef.x - this.playerPos.x
    const fdy = facingRef.y - this.playerPos.y
    const angle = Math.atan2(fdy, fdx)
    this.championRenderer.setFacing(angle)

    // Move toward waypoint
    const step = DEFAULT_MOVE_SPEED * dt
    if (step >= dist) {
      this.playerPos.x = target.x
      this.playerPos.y = target.y
      this.waypoints.shift()
    } else {
      this.playerPos.x += (dx / dist) * step
      this.playerPos.y += (dy / dist) * step
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  destroy(): void {
    this.destroyed = true

    // Remove event listeners
    if (this.cleanupMinimapInput) this.cleanupMinimapInput()
    if (this.onResize) window.removeEventListener('resize', this.onResize)
    if (this.onMouseMove) window.removeEventListener('mousemove', this.onMouseMove)
    if (this.onMouseUp) window.removeEventListener('mouseup', this.onMouseUp)
    if (this.onKeyDown) window.removeEventListener('keydown', this.onKeyDown)
    if (this.onKeyUp) window.removeEventListener('keyup', this.onKeyUp)
    if (this.canvas) {
      if (this.onContextMenu) this.canvas.removeEventListener('contextmenu', this.onContextMenu)
      if (this.onMouseDown) this.canvas.removeEventListener('mousedown', this.onMouseDown)
      if (this.onWheel) this.canvas.removeEventListener('wheel', this.onWheel)
      if (this.onSelectStart) this.canvas.removeEventListener('selectstart', this.onSelectStart)
    }

    try {
      // false = don't remove the canvas from the DOM (React owns it)
      this.app.destroy(false, { children: true })
    } catch (err) {
      console.warn('Game.destroy() error (may be pre-init):', err)
    }
  }
}
