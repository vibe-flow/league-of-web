import * as THREE from 'three'
import { COLORS, type WorldPosition, type TowerTier } from '@template-dev/shared'

export class TowerRenderer3D {
  readonly group = new THREE.Group()
  private body: THREE.Mesh
  private bodyMaterial: THREE.MeshLambertMaterial
  private originalColor: THREE.Color
  private flashTimer = 0
  private _isDead = false

  constructor(team: 'blue' | 'red', tier: TowerTier | 'nexus', radius: number) {
    const isNexus = tier === 'nexus'
    const colorHex = isNexus
      ? team === 'blue'
        ? COLORS.NEXUS_BLUE
        : COLORS.NEXUS_RED
      : team === 'blue'
        ? COLORS.TURRET_BLUE
        : COLORS.TURRET_RED

    this.originalColor = new THREE.Color(colorHex)

    // Taller cylinder for towers/nexus
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
    const outline = new THREE.Mesh(outlineGeo, outlineMat)
    outline.rotation.x = -Math.PI / 2
    outline.position.y = height + 0.1
    this.group.add(outline)
  }

  setPosition(pos: WorldPosition): void {
    this.group.position.x = pos.x
    this.group.position.z = pos.y // game Y → Three.js Z
  }

  /** Flash the tower red when taking damage (~150ms). */
  flashDamage(): void {
    this.flashTimer = 0.15
    this.bodyMaterial.color.setHex(0xff2222)
  }

  /** Call from the game update loop to tick the flash timer. */
  updateFlash(dt: number): void {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt
      if (this.flashTimer <= 0) {
        this.flashTimer = 0
        if (this._isDead) {
          this.bodyMaterial.color.setHex(0x444444)
        } else {
          this.bodyMaterial.color.copy(this.originalColor)
        }
      }
    }
  }

  /** Show/hide death visual. */
  setDead(dead: boolean): void {
    this._isDead = dead
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
