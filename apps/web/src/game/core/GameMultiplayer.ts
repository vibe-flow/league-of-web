import { Application, Container } from 'pixi.js'
import { type WorldPosition, type SnapshotPayload } from '@template-dev/shared'
import { useGameSettingsStore } from '@/stores/game-settings.store'
import { Camera } from './Camera'
import { MapRenderer } from '../rendering/MapRenderer'
import { MoveIndicator } from '../rendering/MoveIndicator'
import { Minimap } from '../rendering/Minimap'
import { EntityManager } from '../entities/EntityManager'
import { NetworkClient } from '../network/NetworkClient'
import { SnapshotBuffer } from '../network/SnapshotBuffer'
import { ClockSync } from '../network/ClockSync'

export class GameMultiplayer {
  private app: Application
  private gameContainer!: Container
  private uiContainer!: Container

  private camera!: Camera
  private mapRenderer!: MapRenderer
  private moveIndicator!: MoveIndicator
  private minimap!: Minimap
  private entityManager!: EntityManager

  private networkClient: NetworkClient
  private snapshotBuffer: SnapshotBuffer
  private clockSync: ClockSync

  private localPlayerId: string
  private localEntityId: string

  private destroyed = false
  private _paused = false
  private rightMouseDown = false
  private lastMoveCommandTime = 0
  private static readonly MOVE_THROTTLE_MS = 50

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
  private tickerCallback: ((ticker: { deltaMS: number }) => void) | null = null

  get paused(): boolean {
    return this._paused
  }

  setPaused(paused: boolean): void {
    this._paused = paused
    this.rightMouseDown = false
    this.keysDown.clear()
    this.spaceDown = false
    if (this.camera) {
      this.camera.setLocked(useGameSettingsStore.getState().cameraLocked)
      this.camera.setKeyPan(0, 0)
      this.camera.resetEdgePan()
    }
  }

  constructor(playerId: string) {
    this.app = new Application()
    this.localPlayerId = playerId
    this.localEntityId = `champion_${playerId}`
    this.networkClient = new NetworkClient()
    this.snapshotBuffer = new SnapshotBuffer()
    this.clockSync = new ClockSync()
  }

  async init(
    canvas: HTMLCanvasElement,
    matchId: string,
    serverUrl: string,
    token: string,
  ): Promise<void> {
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

    // Entity manager (handles all champions)
    this.entityManager = new EntityManager(this.gameContainer)

    // Minimap
    this.minimap = new Minimap()
    this.minimap.positionOnScreen(w, h)
    this.uiContainer.addChild(this.minimap.container)

    // Network
    this.networkClient.onSnapshot = (snapshot: SnapshotPayload) => {
      this.snapshotBuffer.push(snapshot)
      this.clockSync.onSnapshot(snapshot.gameTimeMs)
    }
    this.networkClient.connect(serverUrl, matchId, this.localPlayerId, token)

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
    }
    window.addEventListener('resize', this.onResize)

    // Render loop
    this.tickerCallback = (ticker) => {
      if (this.destroyed) return
      const dt = ticker.deltaMS / 1000
      this.update(dt)
    }
    this.app.ticker.add(this.tickerCallback)

    // Initial camera position — will snap to player once first snapshot arrives
    this.camera.snapTo({ x: 3000, y: 600 }) // center of map
  }

  // ===========================================================================
  // Input
  // ===========================================================================

  private issueMoveCommand(screenX: number, screenY: number): void {
    const now = performance.now()
    if (now - this.lastMoveCommandTime < GameMultiplayer.MOVE_THROTTLE_MS) return
    this.lastMoveCommandTime = now

    const worldPos = this.camera.screenToWorld(screenX, screenY)
    this.issueMoveToWorld(worldPos)
  }

  private issueMoveToWorld(worldPos: WorldPosition): void {
    this.networkClient.sendMove(worldPos.x, worldPos.y)
    this.moveIndicator.show(worldPos)
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    this.onContextMenu = (e: MouseEvent) => e.preventDefault()
    canvas.addEventListener('contextmenu', this.onContextMenu)

    this.onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2 || this.destroyed || this._paused) return
      if (this.minimap.containsScreenPoint(e.clientX, e.clientY)) return
      this.rightMouseDown = true
      this.lastMoveCommandTime = 0
      this.issueMoveCommand(e.clientX, e.clientY)
    }
    canvas.addEventListener('mousedown', this.onMouseDown)

    this.onMouseMove = (e: MouseEvent) => {
      if (this.destroyed || this._paused) return
      this.camera.updateEdgePan(e.clientX, e.clientY)
      if (this.rightMouseDown) {
        this.issueMoveCommand(e.clientX, e.clientY)
      }
    }
    window.addEventListener('mousemove', this.onMouseMove)

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
          const pos = this.entityManager.getEntityPosition(this.localEntityId)
          if (pos) {
            this.camera.snapTo(pos)
            this.camera.setLocked(true)
          }
        }
        return
      }

      if (key === 'KeyY') {
        e.preventDefault()
        useGameSettingsStore.getState().toggleCameraLocked()
        const locked = useGameSettingsStore.getState().cameraLocked
        this.camera.setLocked(locked)
        if (locked) {
          const pos = this.entityManager.getEntityPosition(this.localEntityId)
          if (pos) this.camera.snapTo(pos)
        }
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
    this.minimap.onRightClick = (worldPos) => {
      if (this.destroyed || this._paused) return
      this.lastMoveCommandTime = 0
      this.issueMoveToWorld(worldPos)
    }

    this.minimap.onLeftClick = (worldPos) => {
      if (this.destroyed || this._paused) return
      this.camera.panTo(worldPos)
    }

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
    this.moveIndicator.update(dt)

    const renderTimeMs = this.clockSync.getRenderTimeMs()
    const interpState = this.snapshotBuffer.getInterpolationState(renderTimeMs)

    if (interpState) {
      // Update all entity visuals with interpolation
      this.entityManager.update(
        interpState.from.entities,
        interpState.to.entities,
        interpState.alpha,
      )

      // Camera follows local player
      const localPos = this.entityManager.getEntityPosition(this.localEntityId)
      if (localPos) {
        this.camera.update(dt, localPos)
      }

      // Update minimap — show local player position
      if (localPos) {
        this.minimap.updatePlayerPosition(localPos)
      }
    } else {
      // No snapshots yet — just update camera at center
      this.camera.update(dt, { x: 3000, y: 600 })
    }

    // Minimap reposition + camera view
    this.minimap.positionOnScreen(this.app.screen.width, this.app.screen.height)
    this.minimap.updateCameraView(
      this.camera.x,
      this.camera.y,
      this.app.screen.width,
      this.app.screen.height,
      this.camera.zoom,
    )
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  destroy(): void {
    this.destroyed = true

    this.networkClient.disconnect()
    this.entityManager?.destroy()

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

    // Explicitly remove ticker before destroying app
    if (this.tickerCallback && this.app.ticker) {
      this.app.ticker.remove(this.tickerCallback)
      this.tickerCallback = null
    }

    // Explicitly destroy sub-renderers
    this.mapRenderer?.destroy()
    this.minimap?.destroy()
    this.moveIndicator?.destroy()

    try {
      // Only destroy if init() completed (stage exists)
      if (this.app.stage) {
        this.app.destroy(false, { children: true })
      }
    } catch (err) {
      console.warn('GameMultiplayer.destroy() error:', err)
    }
  }
}
