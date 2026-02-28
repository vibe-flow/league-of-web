import * as THREE from 'three'
import { COLORS, type WorldPosition } from '@template-dev/shared'

/** A small animated ring that appears where the player clicks to move. */
export class MoveIndicator {
  readonly mesh: THREE.Mesh
  private material: THREE.MeshBasicMaterial
  private timer = 0
  private active = false
  private static readonly DURATION = 0.6 // seconds
  private static readonly RADIUS = 20

  constructor() {
    // Ring geometry lying flat on the ground
    const geo = new THREE.RingGeometry(MoveIndicator.RADIUS * 0.9, MoveIndicator.RADIUS, 32)
    this.material = new THREE.MeshBasicMaterial({
      color: COLORS.MOVE_INDICATOR,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.y = 0.1 // slightly above ground
    this.mesh.visible = false
  }

  show(pos: WorldPosition): void {
    this.mesh.position.x = pos.x
    this.mesh.position.z = pos.y // game Y → Three.js Z
    this.mesh.visible = true
    this.active = true
    this.timer = 0
    this.mesh.scale.set(0.5, 0.5, 0.5)
    this.material.opacity = 1
  }

  update(dt: number): void {
    if (!this.active) return

    this.timer += dt
    const t = this.timer / MoveIndicator.DURATION

    if (t >= 1) {
      this.active = false
      this.mesh.visible = false
      return
    }

    // Expanding ring that fades out
    const scale = 0.5 + t * 0.5
    this.mesh.scale.set(scale, scale, scale)
    this.material.opacity = 1 - t
  }

  destroy(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.mesh.parent?.remove(this.mesh)
  }
}
