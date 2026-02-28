import type { BaseStats, ChampionDefinition, AttackTimings } from './combat'
import { DAMAGE_POINT_PERCENT } from './combat-constants'

/**
 * Compute effective stats at a given level.
 * Formula: stat(N) = base + growth × (N - 1)
 */
export function getStatsAtLevel(def: ChampionDefinition, level: number): BaseStats {
  const l = Math.max(1, Math.min(level, 18))
  const growth = def.statsPerLevel
  const base = def.baseStats
  const factor = l - 1

  return {
    hp: base.hp + (growth.hp ?? 0) * factor,
    mp: base.mp + (growth.mp ?? 0) * factor,
    ad: base.ad + (growth.ad ?? 0) * factor,
    ap: base.ap + (growth.ap ?? 0) * factor,
    armor: base.armor + (growth.armor ?? 0) * factor,
    magicResist: base.magicResist + (growth.magicResist ?? 0) * factor,
    attackSpeed: base.attackSpeed + (growth.attackSpeed ?? 0) * factor,
    moveSpeed: base.moveSpeed + (growth.moveSpeed ?? 0) * factor,
    attackRange: base.attackRange + (growth.attackRange ?? 0) * factor,
    hpRegen: base.hpRegen + (growth.hpRegen ?? 0) * factor,
    mpRegen: base.mpRegen + (growth.mpRegen ?? 0) * factor,
    critChance: base.critChance + (growth.critChance ?? 0) * factor,
  }
}

/**
 * Calculate auto-attack phase timings from attack speed and windup percent.
 *
 * totalMs     = 1000 / attackSpeed
 * windupMs    = totalMs × baseWindupPercent
 * damagePoint = totalMs × 0.05
 * recoveryMs  = totalMs - windupMs - damagePointMs
 */
export function calculateAttackTimings(
  attackSpeed: number,
  baseWindupPercent: number,
): AttackTimings {
  const totalMs = 1000 / attackSpeed
  const windupMs = totalMs * baseWindupPercent
  const damagePointMs = totalMs * DAMAGE_POINT_PERCENT
  const recoveryMs = totalMs - windupMs - damagePointMs

  return { totalMs, windupMs, damagePointMs, recoveryMs }
}

/**
 * Apply resistance (armor or magic resist) to raw damage.
 *
 * If resistance >= 0: mitigated = raw × (100 / (100 + resistance))
 * If resistance < 0:  mitigated = raw × (2 - 100 / (100 - resistance))
 */
export function applyResistance(rawDamage: number, resistance: number): number {
  if (resistance >= 0) {
    return rawDamage * (100 / (100 + resistance))
  }
  return rawDamage * (2 - 100 / (100 - resistance))
}
