import * as THREE from 'three'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { type WorldPosition, type SnapshotPayload, type Team } from '@template-dev/shared'
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
  private renderer!: THREE.WebGLRenderer
  private cssRenderer!: CSS2DRenderer
  readonly scene = new THREE.Scene()
  private lastTime = 0
  private animationFrameId = 0

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
  private lastMoveTarget: WorldPosition | null = null

  // Camera pan keys state
  private keysDown = new Set<string>()
  private spaceDown = false

  // Local player team (resolved from first snapshot)
  private localTeam: Team | null = null

  /** gameTimeMs of the last interpolated "to" snapshot whose events we consumed. */
  private lastProcessedEventTime = 0
  /** Whether we've logged the first successful interpolation (debug). */
  private hasLoggedFirstInterp = false

  // Callback to expose local player snapshot data to React (for HUD)
  onLocalPlayerUpdate: ((snapshot: SnapshotPayload['entities'][0] | null) => void) | null = null

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
    this.localPlayerId = playerId
    this.localEntityId = `champion_${playerId}`
    this.networkClient = new NetworkClient()
    this.snapshotBuffer = new SnapshotBuffer()
    this.clockSync = new ClockSync()
  }

  async init(
    canvas: HTMLCanvasElement,
    container: HTMLDivElement,
    matchId: string,
    serverUrl: string,
    token: string,
  ): Promise<void> {
    this.canvas = canvas
    const w = window.innerWidth
    const h = window.innerHeight

    // Three.js WebGL renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio || 1)
    this.renderer.setSize(w, h)
    this.renderer.setClearColor(0x111111)

    // CSS2D renderer for health bars / damage numbers
    this.cssRenderer = new CSS2DRenderer()
    this.cssRenderer.setSize(w, h)
    this.cssRenderer.domElement.style.position = 'absolute'
    this.cssRenderer.domElement.style.top = '0'
    this.cssRenderer.domElement.style.left = '0'
    this.cssRenderer.domElement.style.pointerEvents = 'none'
    container.appendChild(this.cssRenderer.domElement)

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7)
    this.scene.add(ambientLight)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
    dirLight.position.set(3000, 1000, 600)
    this.scene.add(dirLight)

    // Camera
    this.camera = new Camera(w, h)
    this.camera.setZoom(0.8)

    // Map
    this.mapRenderer = new MapRenderer()
    this.mapRenderer.build()
    this.scene.add(this.mapRenderer.group)

    // Move indicator
    this.moveIndicator = new MoveIndicator()
    this.scene.add(this.moveIndicator.mesh)

    // Entity manager (handles all champions + towers)
    this.entityManager = new EntityManager(this.scene)

    // Minimap
    this.minimap = new Minimap(this.renderer, this.scene, this.camera)
    this.minimap.positionOnScreen(w, h)

    // Network
    let snapshotCount = 0
    this.networkClient.onSnapshot = (snapshot: SnapshotPayload) => {
      snapshotCount++
      this.snapshotBuffer.push(snapshot)
      this.clockSync.onSnapshot(snapshot.gameTimeMs)

      // Resolve local team directly from the snapshot data
      if (!this.localTeam) {
        const localEntity = snapshot.entities.find((e) => e.id === this.localEntityId)
        if (localEntity) {
          this.localTeam = localEntity.team
          console.warn(
            `[Game] Local player resolved: ${this.localEntityId} team=${localEntity.team}`,
          )
        }
      }

      // Log first few snapshots for debugging
      if (snapshotCount <= 3) {
        const localEntity = snapshot.entities.find((e) => e.id === this.localEntityId)
        console.warn(
          `[Game] Snapshot #${snapshotCount}: entities=${snapshot.entities.length} localEntity=${localEntity ? `(${localEntity.x.toFixed(0)},${localEntity.y.toFixed(0)})` : 'NOT FOUND'} gameTime=${snapshot.gameTimeMs}`,
        )
      }
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
      this.renderer.setSize(nw, nh)
      this.cssRenderer.setSize(nw, nh)
      this.camera.setScreenSize(nw, nh)
      this.minimap.positionOnScreen(nw, nh)
    }
    window.addEventListener('resize', this.onResize)

    // Animation loop
    this.lastTime = performance.now()
    const animate = () => {
      if (this.destroyed) return
      this.animationFrameId = requestAnimationFrame(animate)
      const now = performance.now()
      const dt = (now - this.lastTime) / 1000
      this.lastTime = now
      this.update(dt)

      // Render main scene
      this.renderer.render(this.scene, this.camera.threeCamera)
      this.cssRenderer.render(this.scene, this.camera.threeCamera)

      // Render minimap
      this.minimap.render()
    }
    animate()

    // Initial camera position — will snap to player once first snapshot arrives
    this.camera.snapTo({ x: 3000, y: 600 })
  }

  // ===========================================================================
  // Input
  // ===========================================================================

  private issueRightClickCommand(screenX: number, screenY: number): void {
    const now = performance.now()
    if (now - this.lastMoveCommandTime < GameMultiplayer.MOVE_THROTTLE_MS) return
    this.lastMoveCommandTime = now

    if (!this.networkClient.connected) {
      console.warn('[Game] Right-click ignored: WebSocket not connected')
      return
    }

    const worldPos = this.camera.screenToWorld(screenX, screenY)

    // Hit test: check if right-clicking on an enemy champion
    if (this.localTeam) {
      const targetId = this.entityManager.hitTest(worldPos.x, worldPos.y, this.localTeam)
      if (targetId) {
        this.networkClient.sendAttack(targetId)
        return
      }
    }

    // No enemy under cursor — move
    this.issueMoveToWorld(worldPos)
  }

  private issueMoveToWorld(worldPos: WorldPosition): void {
    this.networkClient.sendMove(worldPos.x, worldPos.y)
    this.moveIndicator.show(worldPos)
    this.lastMoveTarget = worldPos
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    this.onContextMenu = (e: MouseEvent) => e.preventDefault()
    canvas.addEventListener('contextmenu', this.onContextMenu)

    this.onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2 || this.destroyed || this._paused) return
      if (this.minimap.containsScreenPoint(e.clientX, e.clientY)) return
      this.rightMouseDown = true
      this.lastMoveCommandTime = 0
      this.issueRightClickCommand(e.clientX, e.clientY)
    }
    canvas.addEventListener('mousedown', this.onMouseDown)

    this.onMouseMove = (e: MouseEvent) => {
      if (this.destroyed || this._paused) return
      this.camera.updateEdgePan(e.clientX, e.clientY)
      if (this.rightMouseDown) {
        this.issueRightClickCommand(e.clientX, e.clientY)
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

      if (key === 'KeyS') {
        e.preventDefault()
        this.networkClient.sendStop()
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
      // Only pass events from the "to" snapshot if we haven't processed them yet
      const toTime = interpState.to.gameTimeMs
      const events = toTime > this.lastProcessedEventTime ? interpState.to.events : undefined
      if (events && events.length > 0) {
        this.lastProcessedEventTime = toTime
      }

      // Update all entity visuals with interpolation + combat events
      this.entityManager.update(
        interpState.from.entities,
        interpState.to.entities,
        interpState.alpha,
        dt,
        events,
      )

      // Notify React of local player state (for HUD)
      const localSnapshot = this.entityManager.getEntitySnapshot(this.localEntityId)
      this.onLocalPlayerUpdate?.(localSnapshot)

      // Camera follows local player
      const localPos = this.entityManager.getEntityPosition(this.localEntityId)

      if (!this.hasLoggedFirstInterp) {
        this.hasLoggedFirstInterp = true
        console.warn(
          `[Game] First interpolation: alpha=${interpState.alpha.toFixed(2)} entities=${interpState.to.entities.length} localPos=${localPos ? `(${localPos.x.toFixed(0)},${localPos.y.toFixed(0)})` : 'null'}`,
        )
      }

      if (localPos) {
        this.camera.update(dt, localPos)
      }

      // Update minimap — show local player position + move target
      if (localPos) {
        this.minimap.updatePlayerPosition(localPos)

        // Clear move target when player reaches destination
        if (this.lastMoveTarget) {
          const dx = localPos.x - this.lastMoveTarget.x
          const dy = localPos.y - this.lastMoveTarget.y
          if (dx * dx + dy * dy < 400) {
            this.lastMoveTarget = null
          }
        }
      }
      this.minimap.updateMoveTarget(this.lastMoveTarget)
    } else {
      // No snapshots yet — just update camera at center
      this.camera.update(dt, { x: 3000, y: 600 })
    }

    // Minimap camera view update
    this.minimap.updateCameraView(
      this.camera.x,
      this.camera.y,
      window.innerWidth,
      window.innerHeight,
      this.camera.zoom,
    )
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  destroy(): void {
    this.destroyed = true

    cancelAnimationFrame(this.animationFrameId)
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

    // Cleanup sub-renderers
    this.mapRenderer?.destroy()
    this.minimap?.destroy()
    this.moveIndicator?.destroy()

    // Remove CSS2D renderer DOM element
    this.cssRenderer?.domElement.remove()

    // Dispose Three.js resources
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose())
        } else {
          obj.material.dispose()
        }
      }
    })

    this.renderer?.dispose()
  }
}
