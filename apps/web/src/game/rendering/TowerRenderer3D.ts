import * as THREE from 'three'
import { COLORS, type WorldPosition, type TowerTier } from '@template-dev/shared'
import { useGameSettingsStore } from '@/stores/game-settings.store'

interface SavedMaterial {
  material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial
  emissiveHex: number
  emissiveIntensity: number
}

export class TowerRenderer3D {
  readonly group = new THREE.Group()
  private body: THREE.Mesh
  private bodyMaterial: THREE.MeshLambertMaterial
  private outline: THREE.Mesh
  private originalColor: THREE.Color
  private flashTimer = 0
  private _isDead = false

  // GLB model support
  private glbModel: THREE.Group | null = null
  private glbMaterials: SavedMaterial[] = []
  private baseScale = 1 // computed auto-scale for GLB model

  constructor(
    _team: 'blue' | 'red',
    readonly tier: TowerTier | 'nexus',
    radius: number,
  ) {
    const isNexus = tier === 'nexus'
    const colorHex = isNexus
      ? _team === 'blue'
        ? COLORS.NEXUS_BLUE
        : COLORS.NEXUS_RED
      : _team === 'blue'
        ? COLORS.TURRET_BLUE
        : COLORS.TURRET_RED

    this.originalColor = new THREE.Color(colorHex)

    // Fallback cylinder (shown until GLB loads)
    const height = isNexus ? 60 : 40
    const bodyGeo = new THREE.CylinderGeometry(radius, radius, height, 32)
    this.bodyMaterial = new THREE.MeshLambertMaterial({ color: colorHex })
    this.body = new THREE.Mesh(bodyGeo, this.bodyMaterial)
    this.body.position.y = height / 2
    this.group.add(this.body)

    // Outline ring at top
    const outlineGeo = new THREE.RingGeometry(radius - 1, radius + 2, 32)
    const outlineMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
    })
    this.outline = new THREE.Mesh(outlineGeo, outlineMat)
    this.outline.rotation.x = -Math.PI / 2
    this.outline.position.y = height + 0.1
    this.group.add(this.outline)
  }

  /**
   * Replace placeholder geometry with a loaded GLB model.
   */
  setGLBModel(model: THREE.Group): void {
    // Hide fallback geometry
    this.body.visible = false
    this.outline.visible = false

    // Scale model to fit tower size
    const box = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3()
    box.getSize(size)

    console.log(
      `[TowerRenderer3D] ${this.tier} raw size: ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)}`,
    )

    // Target height in game world units:
    // Towers should be roughly 80-120 units tall, nexus ~120-160
    const targetHeight = this.tier === 'nexus' ? 120 : 80
    this.baseScale = targetHeight / Math.max(size.y, 0.01)
    const userScale = useGameSettingsStore.getState().structureScale
    model.scale.setScalar(this.baseScale * userScale)

    console.log(
      `[TowerRenderer3D] ${this.tier} baseScale=${this.baseScale.toFixed(3)} userScale=${userScale} (targetH=${targetHeight}, rawH=${size.y.toFixed(3)})`,
    )

    // Re-center after scaling
    const scaledBox = new THREE.Box3().setFromObject(model)
    const center = new THREE.Vector3()
    scaledBox.getCenter(center)
    model.position.x -= center.x
    model.position.z -= center.z
    model.position.y -= scaledBox.min.y // sit on ground

    // Collect materials for flash/death effects
    this.glbMaterials = []
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial
        if (mat.emissive) {
          this.glbMaterials.push({
            material: mat,
            emissiveHex: mat.emissive.getHex(),
            emissiveIntensity: mat.emissiveIntensity,
          })
        }
      }
    })

    this.glbModel = model
    this.group.add(model)
  }

  setPosition(pos: WorldPosition): void {
    this.group.position.x = pos.x
    this.group.position.y = useGameSettingsStore.getState().championHeight
    this.group.position.z = pos.y // game Y → Three.js Z
  }

  /** Flash the tower red when taking damage (~150ms). */
  flashDamage(): void {
    this.flashTimer = 0.15
    if (this.glbModel) {
      for (const entry of this.glbMaterials) {
        entry.material.emissive.setHex(0xff2222)
        entry.material.emissiveIntensity = 0.6
      }
    } else {
      this.bodyMaterial.color.setHex(0xff2222)
    }
  }

  /** Call from the game update loop to tick the flash timer. */
  updateFlash(dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      if (this.flashTimer <= 0) {
        this.flashTimer = 0
        this.restoreFlash()
      }
    }
  }

  private restoreFlash(): void {
    if (this.glbModel) {
      for (const entry of this.glbMaterials) {
        if (this._isDead) {
          entry.material.emissive.setHex(0x000000)
          entry.material.emissiveIntensity = 0
        } else {
          entry.material.emissive.setHex(entry.emissiveHex)
          entry.material.emissiveIntensity = entry.emissiveIntensity
        }
      }
    } else {
      if (this._isDead) {
        this.bodyMaterial.color.setHex(0x444444)
      } else {
        this.bodyMaterial.color.copy(this.originalColor)
      }
    }
  }

  /** Show/hide death visual. */
  setDead(dead: boolean): void {
    this._isDead = dead
    if (this.glbModel) {
      this.glbModel.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial
          mat.transparent = dead
          mat.opacity = dead ? 0.2 : 1
        }
      })
    }
    // Also update fallback
    if (dead) {
      this.bodyMaterial.color.setHex(0x444444)
      this.bodyMaterial.transparent = true
      this.bodyMaterial.opacity = 0.2
    } else {
      this.bodyMaterial.color.copy(this.originalColor)
      this.bodyMaterial.transparent = false
      this.bodyMaterial.opacity = 1
    }
  }

  /** Apply a user-controlled scale multiplier on top of the auto-computed base scale. */
  setStructureScale(multiplier: number): void {
    if (this.glbModel) {
      this.glbModel.scale.setScalar(this.baseScale * multiplier)
    }
  }

  // Towers don't have facing or attack animations
  setFacing(_angle: number): void {}
  setAttacking(_attacking: boolean, _phase?: string): void {}

  destroy(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
    })
    this.group.parent?.remove(this.group)
  }
}
