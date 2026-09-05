import * as THREE from 'three'
import {
  DEFAULT_CHAMPION_RADIUS,
  COLORS,
  type WorldPosition,
  type AttackPhase,
} from '@template-dev/shared'
import { useGameSettingsStore } from '@/stores/game-settings.store'

const DEG2RAD = Math.PI / 180

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
  private baseScale = 1 // computed auto-scale before user multiplier

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
    this.group.position.y = useGameSettingsStore.getState().championHeight
    this.group.position.z = pos.y // game Y → Three.js Z
  }

  setFacing(angle: number): void {
    this._facing = angle
    // Rotate the entire group around Y axis
    // In Three.js XZ plane: angle 0 = +X, PI/2 = +Z
    // Add modelRotationOffset to compensate for GLB model's intrinsic orientation
    const offset = useGameSettingsStore.getState().modelRotationOffset * DEG2RAD
    this.group.rotation.y = -angle + offset
  }

  get facing(): number {
    return this._facing
  }

  /** Whether a GLB model with animations is loaded. */
  get hasModel(): boolean {
    return this.mixer !== null
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

  /**
   * Find an animation action by exact name, then by prefix/fuzzy match.
   * LoL GLB clips have varying naming conventions:
   *   "Run", "Run_Base", "Run_Fast", "Attack1.ASU_Teemo.anm", etc.
   * This finds the best match for a requested clip name.
   */
  private findAction(clipName: string): THREE.AnimationAction | null {
    // 1. Exact match
    const exact = this.animations.get(clipName)
    if (exact) return exact

    // 2. Case-insensitive exact match
    const lowerName = clipName.toLowerCase()
    for (const [key, action] of this.animations) {
      if (key.toLowerCase() === lowerName) return action
    }

    // 3. Prefix match: "Run" matches "Run_Base", "Run_Fast"
    //    "Attack1" matches "Attack1.ASU_Teemo.anm"
    for (const [key, action] of this.animations) {
      const lowerKey = key.toLowerCase()
      if (lowerKey.startsWith(lowerName + '_') || lowerKey.startsWith(lowerName + '.')) {
        return action
      }
    }

    // 4. Suffix/contains match for base names: "Idle1" in "Idle1_Base"
    for (const [key, action] of this.animations) {
      if (key.toLowerCase().startsWith(lowerName)) {
        return action
      }
    }

    return null
  }

  /** Play an animation by state name with configurable crossfade duration. */
  playAnimation(clipName: string, fadeTime = 0.15): void {
    if (!this.mixer) return
    const action = this.findAction(clipName)
    if (!action || action === this.currentAction) return

    if (this.currentAction) {
      this.currentAction.fadeOut(fadeTime)
    }
    action.reset().fadeIn(fadeTime).play()
    this.currentAction = action
  }

  /**
   * Play a one-shot animation (spell), then return to idle.
   * If `onComplete` is provided, it is called when the animation finishes
   * instead of the default "fade back to idle" behavior.
   */
  playOneShotAnimation(clipName: string, onComplete?: () => void, fadeTime = 0.1): void {
    if (!this.mixer) {
      onComplete?.()
      return
    }
    const action = this.findAction(clipName)
    if (!action) {
      onComplete?.()
      return
    }

    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true

    if (this.currentAction) {
      this.currentAction.fadeOut(fadeTime)
    }
    action.fadeIn(fadeTime).play()
    this.currentAction = action

    const onFinished = (e: { action: THREE.AnimationAction }) => {
      if (e.action === action) {
        this.mixer?.removeEventListener('finished', onFinished)
        if (onComplete) {
          action.fadeOut(fadeTime)
          onComplete()
        } else {
          const idleAction = this.findAction('Idle1')
          if (idleAction) {
            action.fadeOut(fadeTime)
            idleAction.reset().fadeIn(fadeTime).play()
            this.currentAction = idleAction
          }
        }
      }
    }
    this.mixer.addEventListener('finished', onFinished)
  }

  /** Apply user-controlled scale multiplier on top of the auto-computed base scale. */
  setModelScale(multiplier: number): void {
    if (this.glbModel) {
      this.glbModel.scale.setScalar(this.baseScale * multiplier)
    }
  }

  /** Set GLB model with auto-scaling to fit champion radius. */
  setGLBModel(model: THREE.Group, animations: THREE.AnimationClip[]): void {
    // Remove previous GLB model if swapping
    if (this.glbModel) {
      this.group.remove(this.glbModel)
      this.mixer?.stopAllAction()
      this.mixer = null
      this.animations.clear()
      this.currentAction = null
    }

    // Hide placeholder geometry
    this.body.visible = false
    this.arrow.visible = false

    // Reset any prior transforms on the model root
    model.scale.setScalar(1)
    model.position.set(0, 0, 0)
    model.rotation.set(0, 0, 0)
    model.updateMatrixWorld(true)

    // Compute bounding box from raw geometry (not skinned pose which can be huge)
    const box = new THREE.Box3()
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.geometry.computeBoundingBox()
        if (mesh.geometry.boundingBox) {
          const meshBox = mesh.geometry.boundingBox.clone()
          meshBox.applyMatrix4(mesh.matrixWorld)
          box.union(meshBox)
        }
      }
    })

    // Fallback if no meshes found
    if (box.isEmpty()) {
      box.setFromObject(model)
    }

    const size = new THREE.Vector3()
    box.getSize(size)
    const height = size.y
    console.log(
      `[ChampionRenderer3D] Raw model size: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}`,
    )

    if (height > 0) {
      // The game uses large world units (champion radius = 50, map ~14000x14000)
      // A visible champion model should be around 200 game units tall
      const targetHeight = 200
      this.baseScale = targetHeight / height
      model.scale.setScalar(this.baseScale)
      console.log(
        `[ChampionRenderer3D] Scale: ${this.baseScale.toFixed(6)} (raw height=${height.toFixed(1)} → target=${targetHeight})`,
      )
    }

    // Update world matrices after scaling
    model.updateMatrixWorld(true)

    // Recompute bounding box after scaling (using geometry, not skinned pose)
    const scaledBox = new THREE.Box3()
    model.traverse((child2) => {
      if ((child2 as THREE.Mesh).isMesh) {
        const m = child2 as THREE.Mesh
        m.geometry.computeBoundingBox()
        if (m.geometry.boundingBox) {
          const mb = m.geometry.boundingBox.clone()
          mb.applyMatrix4(m.matrixWorld)
          scaledBox.union(mb)
        }
      }
    })
    if (scaledBox.isEmpty()) {
      scaledBox.setFromObject(model)
    }
    const center = new THREE.Vector3()
    scaledBox.getCenter(center)

    // Center horizontally, sit on ground
    model.position.x -= center.x
    model.position.z -= center.z
    model.position.y -= scaledBox.min.y // bottom of model at y=0

    // Setup animation mixer
    this.mixer = new THREE.AnimationMixer(model)
    for (const clip of animations) {
      const action = this.mixer.clipAction(clip)
      this.animations.set(clip.name, action)
    }
    this.glbModel = model
    this.group.add(model)

    // Auto-play idle animation if available
    const idleAction = this.findAction('Idle1')
    if (idleAction) {
      idleAction.reset().play()
      this.currentAction = idleAction
    }
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
