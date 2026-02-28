// =============================================================================
// Entity States
// =============================================================================

export enum EntityState {
  Idle = 'idle',
  Moving = 'moving',
  Attacking = 'attacking',
  Dead = 'dead',
  Respawning = 'respawning',
}

export enum AttackPhase {
  Windup = 'windup',
  DamagePoint = 'damage_point',
  Recovery = 'recovery',
}

// =============================================================================
// Damage
// =============================================================================

export type DamageType = 'physical' | 'magical' | 'true'

export interface DamageResult {
  rawDamage: number
  mitigatedDamage: number
  finalDamage: number
  damageType: DamageType
  killed: boolean
}

// =============================================================================
// Stats
// =============================================================================

export interface BaseStats {
  hp: number
  mp: number
  ad: number
  ap: number
  armor: number
  magicResist: number
  attackSpeed: number
  moveSpeed: number
  attackRange: number
  hpRegen: number
  mpRegen: number
  critChance: number
}

export type StatsPerLevel = Partial<BaseStats>

// =============================================================================
// Champion Definition
// =============================================================================

export interface ChampionDefinition {
  id: string
  name: string
  baseStats: BaseStats
  statsPerLevel: StatsPerLevel
  /** Windup fraction of total attack time (e.g. 0.3 = 30%) */
  baseWindupPercent: number
  /** Whether this champion is melee (true) or ranged (false) */
  isMelee: boolean
  /** Projectile speed for ranged attacks (units/sec). 0 for melee. */
  projectileSpeed: number
}

// =============================================================================
// Attack Timings
// =============================================================================

export interface AttackTimings {
  /** Total attack cycle duration in ms */
  totalMs: number
  /** Windup phase duration in ms (cancellable) */
  windupMs: number
  /** Damage point duration in ms (committed — damage is dealt) */
  damagePointMs: number
  /** Recovery phase duration in ms (cancellable, enables orb-walking) */
  recoveryMs: number
}
