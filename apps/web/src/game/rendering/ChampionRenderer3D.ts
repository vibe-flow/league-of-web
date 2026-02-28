import * as THREE from 'three'
import {
  DEFAULT_CHAMPION_RADIUS,
  COLORS,
  type WorldPosition,
  type AttackPhase,
} from '@template-dev/shared'

export class ChampionRenderer3D {
  readonly group = new THREE.Group()
  private body: THREE.Mesh
  private bodyMaterial: THREE.MeshLambertMaterial
  private arrow: THREE.Mesh
  private attackArc: THREE.Line | null = null
  private attackArcGeo: THREE.BufferGeometry | null = null
  private deathOverlay: THREE.Group
  private _facing = 0

  private originalColor: THREE.Color
  private flashTimer = 0
  private _isDead = false

  // For GLB model support
  private mixer: THREE.AnimationMixer | null = null
  private animations = new Map<string, THREE.AnimationAction>()
  private currentAction: THREE.AnimationAction | null = null
  private glbModel: THREE.Group | null = null

  constructor(color: number = COLORS.CHAMPION_BLUE) {
    this.originalColor = new THREE.Color(color)

    // Circle body — short cylinder lying on ground
    const bodyGeo = new THREE.CylinderGeometry(
      DEFAULT_CHAMPION_RADIUS,
      DEFAULT_CHAMPION_RADIUS,
      20,
      32,
    )
    this.bodyMaterial = new THREE.MeshLambertMaterial({ color })
    this.body = new THREE.Mesh(bodyGeo, this.bodyMaterial)
    this.body.position.y = 10 // half height above ground
    this.group.add(this.body)

    // Outline ring
    const outlineGeo = new THREE.RingGeometry(
      DEFAULT_CHAMPION_RADIUS - 1,
      DEFAULT_CHAMPION_RADIUS + 2,
      32,
    )
    const outlineMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
    })
    const outline = new THREE.Mesh(outlineGeo, outlineMat)
    outline.rotation.x = -Math.PI / 2
    outline.position.y = 20.1
    this.group.add(outline)

    // Direction arrow — cone pointing in +X direction
    const arrowGeo = new THREE.ConeGeometry(8, 25, 8)
    arrowGeo.rotateZ(-Math.PI / 2) // point along +X
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    this.arrow = new THREE.Mesh(arrowGeo, arrowMat)
    this.arrow.position.set(DEFAULT_CHAMPION_RADIUS * 0.8, 21, 0)
    this.group.add(this.arrow)

    // Death overlay (hidden by default) — red X
    this.deathOverlay = new THREE.Group()
    this.deathOverlay.visible = false
    this.buildDeathOverlay()
    this.group.add(this.deathOverlay)
  }

  private buildDeathOverlay(): void {
    const r = DEFAULT_CHAMPION_RADIUS * 0.6
    const mat = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 })

    // Line 1: top-left to bottom-right
    const pts1 = [new THREE.Vector3(-r, 25, -r), new THREE.Vector3(r, 25, r)]
    const geo1 = new THREE.BufferGeometry().setFromPoints(pts1)
    this.deathOverlay.add(new THREE.Line(geo1, mat))

    // Line 2: top-right to bottom-left
    const pts2 = [new THREE.Vector3(r, 25, -r), new THREE.Vector3(-r, 25, r)]
    const geo2 = new THREE.BufferGeometry().setFromPoints(pts2)
    this.deathOverlay.add(new THREE.Line(geo2, mat))
  }

  setPosition(pos: WorldPosition): void {
    this.group.position.x = pos.x
    this.group.position.z = pos.y // game Y → Three.js Z
  }

  setFacing(angle: number): void {
    this._facing = angle
    // Rotate the entire group around Y axis
    // In Three.js XZ plane: angle 0 = +X, PI/2 = +Z
    this.group.rotation.y = -angle
  }

  get facing(): number {
    return this._facing
  }

  /** Flash the champion red when taking damage (~150ms). */
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
          this.bodyMaterial.color.setHex(0x666666)
        } else {
          this.bodyMaterial.color.copy(this.originalColor)
        }
      }
    }
  }

  /** Show/hide death visual. */
  setDead(dead: boolean): void {
    this._isDead = dead
    this.deathOverlay.visible = dead

    if (dead) {
      this.bodyMaterial.color.setHex(0x666666)
      this.bodyMaterial.transparent = true
      this.bodyMaterial.opacity = 0.4
      this.clearAttackArc()
    } else {
      this.bodyMaterial.color.copy(this.originalColor)
      this.bodyMaterial.transparent = false
      this.bodyMaterial.opacity = 1
    }
  }

  /** Show/hide attack animation based on current phase. */
  setAttacking(attacking: boolean, phase?: AttackPhase): void {
    if (!attacking || this._isDead) {
      this.clearAttackArc()
      return
    }

    this.clearAttackArc()

    const r = DEFAULT_CHAMPION_RADIUS

    if (phase === 'windup') {
      // Small arc behind the champion (winding up)
      const arcPoints: THREE.Vector3[] = []
      const arcStart = -0.4
      const arcEnd = 0.4
      const segments = 12
      for (let i = 0; i <= segments; i++) {
        const t = arcStart + (arcEnd - arcStart) * (i / segments)
        arcPoints.push(new THREE.Vector3(Math.cos(t) * (r + 8), 22, Math.sin(t) * (r + 8)))
      }
      this.attackArcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints)
      const mat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.7 })
      this.attackArc = new THREE.Line(this.attackArcGeo, mat)
      this.group.add(this.attackArc)
    } else if (phase === 'damage_point') {
      // Slash line forward (committed, dealing damage)
      const pts = [new THREE.Vector3(r * 0.5, 22, 0), new THREE.Vector3(r + 20, 22, 0)]
      this.attackArcGeo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
      this.attackArc = new THREE.Line(this.attackArcGeo, mat)
      this.group.add(this.attackArc)
    }
  }

  private clearAttackArc(): void {
    if (this.attackArc) {
      this.group.remove(this.attackArc)
      this.attackArcGeo?.dispose()
      ;(this.attackArc.material as THREE.Material).dispose()
      this.attackArc = null
      this.attackArcGeo = null
    }
  }

  /** Update GLB animation mixer (called every frame). */
  updateAnimation(dt: number): void {
    this.mixer?.update(dt)
  }

  /** Play an animation by state name. */
  playAnimation(clipName: string): void {
    if (!this.mixer) return
    const action = this.animations.get(clipName)
    if (!action || action === this.currentAction) return

    if (this.currentAction) {
      this.currentAction.fadeOut(0.2)
    }
    action.reset().fadeIn(0.2).play()
    this.currentAction = action
  }

  /** Set GLB model (called by AssetManager integration in Phase 6). */
  setGLBModel(model: THREE.Group, animations: THREE.AnimationClip[]): void {
    // Hide placeholder geometry
    this.body.visible = false
    this.arrow.visible = false

    // Setup animation mixer
    this.mixer = new THREE.AnimationMixer(model)
    for (const clip of animations) {
      const action = this.mixer.clipAction(clip)
      this.animations.set(clip.name, action)
    }

    this.group.add(model)
  }

  destroy(): void {
    this.clearAttackArc()

    // Dispose body
    this.body.geometry.dispose()
    this.bodyMaterial.dispose()

    // Dispose all children recursively
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj !== this.body) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      } else if (obj instanceof THREE.Line) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
    })

    this.mixer?.stopAllAction()
    this.group.parent?.remove(this.group)
  }
}
