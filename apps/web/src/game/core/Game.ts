import * as THREE from 'three'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import {
  ARAM_MAP,
  BLUE_SPAWN,
  DEFAULT_MOVE_SPEED,
  DEFAULT_HP,
  DEFAULT_MAX_HP,
  WAYPOINT_REACH_THRESHOLD,
  COLORS,
  TOWER_DEFINITIONS,
  EntityState,
  type WorldPosition,
} from '@template-dev/shared'
import { NavigationGrid, findPath, hasLineOfSight } from '../pathfinding'
import { useGameSettingsStore, type AbilitySlot } from '@/stores/game-settings.store'
import { useHudStore } from '@/stores/hud.store'
import { AssetManager } from '../assets/AssetManager'
import { CRITICAL_ASSETS, ASSET_TURRET, ASSET_NEXUS } from '../assets/asset-paths'
import { Camera } from './Camera'
import { MapRenderer } from '../rendering/MapRenderer'
import { ChampionRenderer3D } from '../rendering/ChampionRenderer3D'
import { AnimationController } from '../rendering/AnimationController'
import { TowerRenderer3D } from '../rendering/TowerRenderer3D'
import { BushRenderer3D } from '../rendering/BushRenderer3D'
import { HealthBar } from '../rendering/HealthBar'
import { MoveIndicator } from '../rendering/MoveIndicator'
import { Minimap } from '../rendering/Minimap'

export class Game {
  private renderer!: THREE.WebGLRenderer
  private cssRenderer!: CSS2DRenderer
  private scene = new THREE.Scene()
  private lastTime = 0
  private animationFrameId = 0

  private camera!: Camera
  private mapRenderer!: MapRenderer
  private championRenderer!: ChampionRenderer3D
  private animController!: AnimationController
  private towerRenderers: TowerRenderer3D[] = []
  private bushRenderers: BushRenderer3D[] = []
  private healthBar!: HealthBar
  private moveIndicator!: MoveIndicator
  private minimap!: Minimap
  private grid!: NavigationGrid

  // Player state
  private playerPos: WorldPosition = { ...BLUE_SPAWN }
  private playerHP = DEFAULT_HP
  private playerMaxHP = DEFAULT_MAX_HP
  private waypoints: WorldPosition[] = []
  private moveTarget: WorldPosition | null = null

  private destroyed = false
  private _paused = false
  private rightMouseDown = false
  private lastMoveCommandTime = 0
  private static readonly MOVE_THROTTLE_MS = 50

  // Camera pan keys state
  private keysDown = new Set<string>()
  private spaceDown = false

  // Callback to notify React that Escape was pressed (React handles the toggle)
  onEscapePressed: (() => void) | null = null

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

  // Champion model tracking
  private loadedChampionAlias = ''
  private loadedSkinId = ''
  private loadedModelScale = 1
  private loadingVersion = 0 // incremented to cancel stale async loads
  private unsubscribeStore: (() => void) | null = null

  get paused(): boolean {
    return this._paused
  }

  setPaused(paused: boolean): void {
    console.log(`[Game] setPaused(${paused})`, new Error().stack?.split('\n')[2]?.trim())
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

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas
    const container = canvas.parentElement as HTMLDivElement
    const w = window.innerWidth
    const h = window.innerHeight

    // Three.js WebGL renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio || 1)
    this.renderer.setSize(w, h)
    this.renderer.setClearColor(0x111111)

    // CSS2D renderer for health bars
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

    // Navigation grid
    this.grid = new NavigationGrid(ARAM_MAP)

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

    // Champion
    this.championRenderer = new ChampionRenderer3D(COLORS.CHAMPION_BLUE)
    this.championRenderer.setPosition(this.playerPos)
    this.scene.add(this.championRenderer.group)

    // Animation controller — centralized animation state management
    const { selectedChampion } = useGameSettingsStore.getState()
    this.animController = new AnimationController(this.championRenderer, selectedChampion)

    // Health bar (child of champion so it moves with it)
    this.healthBar = new HealthBar()
    this.championRenderer.group.add(this.healthBar.object)

    // Towers & Nexuses (static decorative in solo mode)
    for (const def of TOWER_DEFINITIONS) {
      const tower = new TowerRenderer3D(def.team, def.tier, def.radius)
      tower.setPosition(def.position)
      const barWidth = def.tier === 'nexus' ? 160 : 120
      const hb = new HealthBar(barWidth, -(def.radius + 16))
      tower.group.add(hb.object)
      this.scene.add(tower.group)
      this.towerRenderers.push(tower)
    }

    // Bushes (3D procedural vegetation)
    for (const bush of ARAM_MAP.bushZones) {
      const bushRenderer = new BushRenderer3D(bush)
      this.scene.add(bushRenderer.group)
      this.bushRenderers.push(bushRenderer)
    }

    // Load map assets in background (non-blocking)
    this.loadMapAssets()

    // Minimap
    this.minimap = new Minimap(this.renderer, this.scene, this.camera)
    this.minimap.positionOnScreen(w, h)

    // Load champion GLB model from settings
    this.loadChampionFromSettings()

    // Subscribe to champion/skin/scale changes in the store
    this.unsubscribeStore = useGameSettingsStore.subscribe((state) => {
      if (
        state.selectedChampion !== this.loadedChampionAlias ||
        state.selectedSkin !== this.loadedSkinId
      ) {
        this.loadChampionModel(state.selectedChampion, state.selectedSkin)
        this.updateHudChampion(state.selectedChampion)
        this.animController.setChampion(state.selectedChampion)
      }
      const scale = state.modelScale || 1
      if (scale !== this.loadedModelScale) {
        this.loadedModelScale = scale
        this.championRenderer.setModelScale(scale)
      }
    })

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
      this.camera.snapTo(this.playerPos)
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
      try {
        this.update(dt)
        this.renderer.render(this.scene, this.camera.threeCamera)
        this.cssRenderer.render(this.scene, this.camera.threeCamera)
        this.minimap.render()
      } catch (err) {
        console.error('[Game] Error in animation loop:', err)
      }
    }
    animate()

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

  private issueMoveToWorld(worldPos: WorldPosition): void {
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
      this.waypoints = []
      this.moveTarget = null
    }
  }

  private bindInput(canvas: HTMLCanvasElement): void {
    this.onContextMenu = (e: MouseEvent) => e.preventDefault()
    canvas.addEventListener('contextmenu', this.onContextMenu)

    this.onMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return
      if (this.destroyed || this._paused) {
        console.log(`[Game] mousedown blocked: destroyed=${this.destroyed}, paused=${this._paused}`)
        return
      }
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
      if (this.destroyed || e.repeat) return
      const key = e.code

      if (key === 'Escape') {
        // Let React handle the toggle — it calls setPaused
        this.onEscapePressed?.()
        return
      }

      if (this._paused) return

      // Ability keys (Q, W, E, R by default — configurable)
      const keybinds = useGameSettingsStore.getState().abilityKeybinds
      for (const slotStr of Object.keys(keybinds)) {
        const slot = Number(slotStr) as AbilitySlot
        if (key === keybinds[slot]) {
          e.preventDefault()
          const cast = useHudStore.getState().castAbility(slot)
          if (cast) {
            this.animController.castSpell(slot)
          }
          return
        }
      }

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
  // Champion model loading
  // ===========================================================================

  private loadChampionFromSettings(): void {
    const { selectedChampion, selectedSkin } = useGameSettingsStore.getState()
    if (selectedChampion && selectedSkin) {
      this.loadChampionModel(selectedChampion, selectedSkin)
    }
    // Initialize HUD with champion info
    this.updateHudChampion(selectedChampion)
  }

  private updateHudChampion(alias: string): void {
    useHudStore.getState().initChampion(alias)
  }

  private async loadChampionModel(alias: string, skinId: string): Promise<void> {
    if (this.destroyed) return
    // Cancel any previous in-flight load
    const version = ++this.loadingVersion
    // Update tracking immediately to prevent re-triggering from the subscriber
    this.loadedChampionAlias = alias
    this.loadedSkinId = skinId
    try {
      const manager = AssetManager.getInstance()
      await manager.preloadChampion(alias, skinId)
      // Stale — a newer load was triggered while we were loading
      if (this.destroyed || version !== this.loadingVersion) return
      const result = manager.getChampionModel(alias, skinId)
      if (result) {
        this.championRenderer.setGLBModel(result.model, result.animations)
        const scale = useGameSettingsStore.getState().modelScale
        this.championRenderer.setModelScale(scale)
        this.loadedModelScale = scale
      }
    } catch (err) {
      console.warn(`[Game] Failed to load champion model: ${alias}/${skinId}`, err)
    }
  }

  // ===========================================================================
  // Update loop
  // ===========================================================================

  private update(dt: number): void {
    this.updateMovement(dt)
    this.moveIndicator.update(dt)
    this.camera.update(dt, this.playerPos)
    this.animController.update(dt)
    useHudStore.getState().tick(dt)

    // Live-update map transform from debug settings
    this.mapRenderer.updateMapTransform()

    // Toggle tower/bush/champion visibility from map debug settings
    const settings = useGameSettingsStore.getState()
    const hideStructures = settings.mapDebugHideStructures
    for (const t of this.towerRenderers) t.group.visible = !hideStructures
    for (const b of this.bushRenderers) b.group.visible = !hideStructures
    this.championRenderer.group.visible = !hideStructures
    this.moveIndicator.mesh.visible = !hideStructures

    // Live-update entity height and structure scale from settings
    const entityY = settings.championHeight
    for (const t of this.towerRenderers) {
      t.group.position.y = entityY
      t.setStructureScale(settings.structureScale)
    }
    for (const b of this.bushRenderers) b.group.position.y = entityY

    // Update visual positions
    this.championRenderer.setPosition(this.playerPos)
    this.healthBar.update(this.playerHP / this.playerMaxHP)

    // Minimap
    this.minimap.positionOnScreen(window.innerWidth, window.innerHeight)
    this.minimap.updatePlayerPosition(this.playerPos)
    this.minimap.updateMoveTarget(this.moveTarget)
    this.minimap.updateCameraView(
      this.camera.x,
      this.camera.y,
      window.innerWidth,
      window.innerHeight,
      this.camera.zoom,
    )
  }

  private updateMovement(dt: number): void {
    if (this.waypoints.length === 0) {
      this.animController.setState(EntityState.Idle)
      return
    }

    this.animController.setState(EntityState.Moving)

    const target = this.waypoints[0]
    const dx = target.x - this.playerPos.x
    const dy = target.y - this.playerPos.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < WAYPOINT_REACH_THRESHOLD) {
      this.waypoints.shift()
      if (this.waypoints.length === 0) {
        this.moveTarget = null
        this.animController.setState(EntityState.Idle)
        return
      }
      return
    }

    // Update facing direction
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
  // Map & structure asset loading
  // ===========================================================================

  private async loadMapAssets(): Promise<void> {
    if (this.destroyed) return
    const manager = AssetManager.getInstance()

    // 1. Load structure models (turret + nexus, ~2MB total)
    await manager.preloadAssets(CRITICAL_ASSETS)
    if (this.destroyed) return

    // 2. Apply GLB models to towers
    for (const tower of this.towerRenderers) {
      const assetKey = tower.tier === 'nexus' ? ASSET_NEXUS.key : ASSET_TURRET.key
      const clone = manager.getAssetClone(assetKey)
      if (clone) {
        tower.setGLBModel(clone.model)
      }
    }

    // 3. Load map terrain in background (96MB, non-blocking)
    this.mapRenderer.loadMapModel().catch(() => {})
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  destroy(): void {
    this.destroyed = true

    cancelAnimationFrame(this.animationFrameId)

    if (this.unsubscribeStore) this.unsubscribeStore()
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

    this.mapRenderer?.destroy()
    this.minimap?.destroy()
    this.moveIndicator?.destroy()
    this.championRenderer?.destroy()
    this.healthBar?.destroy()
    for (const t of this.towerRenderers) t.destroy()
    for (const b of this.bushRenderers) b.destroy()
    this.cssRenderer?.domElement.remove()

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
