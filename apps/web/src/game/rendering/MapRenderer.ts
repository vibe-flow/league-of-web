import * as THREE from 'three'
import { MAP_WIDTH, MAP_HEIGHT, COLORS } from '@template-dev/shared'
import { useGameSettingsStore } from '@/stores/game-settings.store'
import { AssetManager } from '../assets/AssetManager'
import { ASSET_MAP_HA } from '../assets/asset-paths'

export class MapRenderer {
  readonly group = new THREE.Group()
  private fallbackGroup = new THREE.Group()
  private mapModel: THREE.Group | null = null

  // Computed from the raw model — never changes after load
  private rawCenter = new THREE.Vector3()
  private rawSize = new THREE.Vector3()

  build(): void {
    // Build fallback geometry (immediate, shown until map GLB loads)
    this.buildFallback()
    this.group.add(this.fallbackGroup)
  }

  /**
   * Load the Howling Abyss 3D map model (background, non-blocking).
   * The fallback plane is removed once the model is ready.
   */
  async loadMapModel(): Promise<void> {
    try {
      const manager = AssetManager.getInstance()
      await manager.preloadAsset(ASSET_MAP_HA.key, ASSET_MAP_HA.path)

      const scene = manager.getAssetScene(ASSET_MAP_HA.key)
      if (!scene) return

      this.mapModel = scene.clone()

      // Configure map materials:
      // - DoubleSide so map is visible from any camera angle
      this.mapModel.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          for (const mat of mats) {
            mat.side = THREE.DoubleSide
          }
        }
      })

      // Compute bounding box of the raw model
      const box = new THREE.Box3().setFromObject(this.mapModel)
      box.getSize(this.rawSize)
      box.getCenter(this.rawCenter)

      console.log(
        `[MapRenderer] HA map raw size: ${this.rawSize.x.toFixed(3)} x ${this.rawSize.y.toFixed(3)} x ${this.rawSize.z.toFixed(3)}, ` +
          `center=(${this.rawCenter.x.toFixed(3)}, ${this.rawCenter.y.toFixed(3)}, ${this.rawCenter.z.toFixed(3)})`,
      )

      // Apply initial transform from settings
      this.updateMapTransform()

      // Hide fallback (kept for "use flat map" toggle)
      this.fallbackGroup.visible = false

      this.group.add(this.mapModel)
    } catch (err) {
      console.warn('[MapRenderer] Failed to load map model, keeping fallback', err)
    }
  }

  /**
   * Read map debug settings from the store and apply transforms.
   * Call this from the game update loop for live tuning.
   *
   * Strategy: The raw model is ~1x1x2 units (normalized). We need to:
   * 1. Center it at origin
   * 2. Rotate it (the bridge likely runs along model Z, we need it along game X)
   * 3. Scale it to fit MAP_WIDTH x MAP_HEIGHT
   * 4. Position it so the center of the map aligns with game world center
   * 5. Apply user offsets for fine-tuning
   */
  updateMapTransform(): void {
    const s = useGameSettingsStore.getState()

    // Toggle between 3D map and flat fallback
    if (this.mapModel) {
      this.mapModel.visible = !s.mapDebugHideMap
      this.fallbackGroup.visible = s.mapDebugHideMap
    }

    if (!this.mapModel) return

    // Step 1: Center the raw model at its own origin
    this.mapModel.position.set(-this.rawCenter.x, -this.rawCenter.y, -this.rawCenter.z)

    // Step 2+3+4: Use a wrapper approach — we set position/rotation/scale on the model directly.
    // Since we already shifted position to center, we apply rotation and scale on top.

    // The model's longest axis (Z = 2.0) should map to MAP_WIDTH (6000).
    // After rotation, it will run along game X.
    const longestAxis = Math.max(this.rawSize.x, this.rawSize.z)
    const baseScale = longestAxis > 0 ? MAP_WIDTH / longestAxis : 1

    const finalScale = baseScale * s.mapScale
    const sx = s.mapFlipX ? -finalScale : finalScale
    const sz = s.mapFlipZ ? -finalScale : finalScale

    this.mapModel.scale.set(sx, finalScale, sz)
    this.mapModel.rotation.y = (s.mapRotationY * Math.PI) / 180

    // After centering + scale + rotation, the model center is at (0,0,0).
    // We want the map center at (MAP_WIDTH/2, 0, MAP_HEIGHT/2) in game world.
    // The position already has the centering offset, add the game world offset.
    this.mapModel.position.x = -this.rawCenter.x * sx + MAP_WIDTH / 2 + s.mapOffsetX
    this.mapModel.position.y = -this.rawCenter.y * finalScale + s.mapOffsetY
    this.mapModel.position.z = -this.rawCenter.z * sz + MAP_HEIGHT / 2 + s.mapOffsetZ
  }

  private buildFallback(): void {
    // Clear any existing fallback children
    while (this.fallbackGroup.children.length > 0) {
      const child = this.fallbackGroup.children[0]
      this.fallbackGroup.remove(child)
    }

    // 1. Lane background — flat plane on XZ
    const laneGeo = new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT)
    const laneMat = new THREE.MeshBasicMaterial({ color: COLORS.LANE })
    const lane = new THREE.Mesh(laneGeo, laneMat)
    lane.rotation.x = -Math.PI / 2
    lane.position.set(MAP_WIDTH / 2, 0, MAP_HEIGHT / 2)
    this.fallbackGroup.add(lane)

    // 2. Ground grid lines
    const GRID_SPACING = 400
    const gridPoints: THREE.Vector3[] = []
    for (let gx = GRID_SPACING; gx < MAP_WIDTH; gx += GRID_SPACING) {
      gridPoints.push(new THREE.Vector3(gx, 0.01, 0))
      gridPoints.push(new THREE.Vector3(gx, 0.01, MAP_HEIGHT))
    }
    for (let gy = GRID_SPACING; gy < MAP_HEIGHT; gy += GRID_SPACING) {
      gridPoints.push(new THREE.Vector3(0, 0.01, gy))
      gridPoints.push(new THREE.Vector3(MAP_WIDTH, 0.01, gy))
    }
    const gridGeo = new THREE.BufferGeometry().setFromPoints(gridPoints)
    const gridMat = new THREE.LineBasicMaterial({
      color: 0x000000,
      opacity: 0.08,
      transparent: true,
    })
    const grid = new THREE.LineSegments(gridGeo, gridMat)
    this.fallbackGroup.add(grid)

    // 3. Base zone indicators
    const blueBaseGeo = new THREE.PlaneGeometry(600, MAP_HEIGHT)
    const blueBaseMat = new THREE.MeshBasicMaterial({
      color: COLORS.BLUE_BASE,
      opacity: 0.12,
      transparent: true,
    })
    const blueBase = new THREE.Mesh(blueBaseGeo, blueBaseMat)
    blueBase.rotation.x = -Math.PI / 2
    blueBase.position.set(300, 0.02, MAP_HEIGHT / 2)
    this.fallbackGroup.add(blueBase)

    const redBaseGeo = new THREE.PlaneGeometry(600, MAP_HEIGHT)
    const redBaseMat = new THREE.MeshBasicMaterial({
      color: COLORS.RED_BASE,
      opacity: 0.12,
      transparent: true,
    })
    const redBase = new THREE.Mesh(redBaseGeo, redBaseMat)
    redBase.rotation.x = -Math.PI / 2
    redBase.position.set(MAP_WIDTH - 300, 0.02, MAP_HEIGHT / 2)
    this.fallbackGroup.add(redBase)

    // 4. Map border (walls)
    const borderPoints = [
      new THREE.Vector3(0, 0.05, 0),
      new THREE.Vector3(MAP_WIDTH, 0.05, 0),
      new THREE.Vector3(MAP_WIDTH, 0.05, MAP_HEIGHT),
      new THREE.Vector3(0, 0.05, MAP_HEIGHT),
      new THREE.Vector3(0, 0.05, 0),
    ]
    const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPoints)
    const borderMat = new THREE.LineBasicMaterial({ color: COLORS.WALL, linewidth: 2 })
    const border = new THREE.Line(borderGeo, borderMat)
    this.fallbackGroup.add(border)
  }

  private removeFallback(): void {
    this.fallbackGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      } else if (obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
    })
    this.group.remove(this.fallbackGroup)
  }

  destroy(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      } else if (obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
    })
    this.group.parent?.remove(this.group)
  }
}
