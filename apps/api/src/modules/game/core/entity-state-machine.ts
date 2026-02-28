import { EntityState, AttackPhase, type AttackTimings } from '@template-dev/shared'

export interface StateTickResult {
  /** The attack phase just completed (if any). */
  completedPhase?: AttackPhase
  /** True if the full attack cycle just completed (recovery ended). */
  attackCycleComplete?: boolean
}

export class EntityStateMachine {
  private _state: EntityState = EntityState.Idle
  private _attackPhase: AttackPhase = AttackPhase.Windup
  private _attackTimerMs = 0

  // Attack timing thresholds (set when entering attack state)
  private windupMs = 0
  private damagePointMs = 0
  private recoveryMs = 0

  // Respawn timer
  private _respawnTimerMs = 0

  get state(): EntityState {
    return this._state
  }

  get attackPhase(): AttackPhase {
    return this._attackPhase
  }

  get respawnTimerMs(): number {
    return this._respawnTimerMs
  }

  // =========================================================================
  // State queries
  // =========================================================================

  canPerform(action: 'move' | 'attack' | 'stop'): boolean {
    switch (this._state) {
      case EntityState.Idle:
        return true

      case EntityState.Moving:
        return true

      case EntityState.Attacking:
        // Can cancel during windup or recovery, not during damage point
        if (action === 'move' || action === 'stop') {
          return (
            this._attackPhase === AttackPhase.Windup || this._attackPhase === AttackPhase.Recovery
          )
        }
        // Can start new attack during recovery
        if (action === 'attack') {
          return this._attackPhase === AttackPhase.Recovery
        }
        return false

      case EntityState.Dead:
      case EntityState.Respawning:
        return false
    }
  }

  isAttacking(): boolean {
    return this._state === EntityState.Attacking
  }

  isInWindup(): boolean {
    return this._state === EntityState.Attacking && this._attackPhase === AttackPhase.Windup
  }

  isDead(): boolean {
    return this._state === EntityState.Dead
  }

  // =========================================================================
  // State transitions
  // =========================================================================

  enterIdle(): void {
    this._state = EntityState.Idle
    this._attackTimerMs = 0
  }

  enterMoving(): void {
    this._state = EntityState.Moving
    this._attackTimerMs = 0
  }

  enterAttacking(timings: AttackTimings): void {
    this._state = EntityState.Attacking
    this._attackPhase = AttackPhase.Windup
    this._attackTimerMs = 0
    this.windupMs = timings.windupMs
    this.damagePointMs = timings.damagePointMs
    this.recoveryMs = timings.recoveryMs
  }

  enterDead(respawnTimerMs: number): void {
    this._state = EntityState.Dead
    this._respawnTimerMs = respawnTimerMs
    this._attackTimerMs = 0
  }

  enterRespawning(): void {
    this._state = EntityState.Respawning
  }

  // =========================================================================
  // Tick
  // =========================================================================

  /**
   * Advance the state machine by dtMs milliseconds.
   * Returns info about completed attack phases.
   */
  tick(dtMs: number): StateTickResult {
    const result: StateTickResult = {}

    if (this._state === EntityState.Attacking) {
      this._attackTimerMs += dtMs

      switch (this._attackPhase) {
        case AttackPhase.Windup:
          if (this._attackTimerMs >= this.windupMs) {
            // Transition to damage point
            this._attackPhase = AttackPhase.DamagePoint
            this._attackTimerMs -= this.windupMs
            result.completedPhase = AttackPhase.Windup
          }
          break

        case AttackPhase.DamagePoint:
          if (this._attackTimerMs >= this.damagePointMs) {
            // Transition to recovery
            this._attackPhase = AttackPhase.Recovery
            this._attackTimerMs -= this.damagePointMs
            result.completedPhase = AttackPhase.DamagePoint
          }
          break

        case AttackPhase.Recovery:
          if (this._attackTimerMs >= this.recoveryMs) {
            // Attack cycle complete
            this._attackTimerMs = 0
            result.completedPhase = AttackPhase.Recovery
            result.attackCycleComplete = true
          }
          break
      }
    }

    if (this._state === EntityState.Dead) {
      this._respawnTimerMs -= dtMs
      if (this._respawnTimerMs <= 0) {
        this._respawnTimerMs = 0
      }
    }

    return result
  }
}
