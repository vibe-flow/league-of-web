import { Logger } from '@nestjs/common'
import {
  AttackPhase,
  EntityState,
  type DamageResult,
  type DamageEvent,
  applyResistance,
} from '@template-dev/shared'
import type { ChampionEntity, Attackable, TowerEntity } from './game-state'

const logger = new Logger('CombatSystem')

/**
 * Check if attacker is within attack range of target.
 */
function isInRange(attacker: ChampionEntity, target: Attackable): boolean {
  const dx = target.x - attacker.x
  const dy = target.y - attacker.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  return dist <= attacker.stats.effectiveStats.attackRange + target.radius
}

/**
 * Compute facing angle from attacker to target.
 */
function facingTo(from: ChampionEntity, to: Attackable): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

/**
 * Run the damage pipeline (simplified for Phase 3: physical auto-attacks only).
 *
 * 1. Raw damage = attacker AD
 * 2. Type = physical
 * 3. Mitigated = raw × (100 / (100 + target.armor))
 * 4. target.hp -= mitigated
 * 5. Death check
 */
export function processDamage(source: ChampionEntity, target: Attackable): DamageResult {
  const rawDamage = source.stats.effectiveStats.ad
  const resistance = target.armor
  const mitigated = applyResistance(rawDamage, resistance)
  const finalDamage = Math.max(0, Math.round(mitigated * 100) / 100)

  target.hp -= finalDamage
  if (target.hp < 0) target.hp = 0

  return {
    rawDamage,
    mitigatedDamage: rawDamage - finalDamage,
    finalDamage,
    damageType: 'physical',
    killed: target.hp <= 0,
  }
}

/**
 * Handle an attack command: validate target and start attack or move-to-attack.
 */
export function handleAttackCommand(
  attacker: ChampionEntity,
  targetId: string,
  entities: Map<string, ChampionEntity>,
  towers: Map<string, TowerEntity>,
  canAttackTower?: (tower: TowerEntity) => boolean,
): void {
  // Resolve target from champions or towers
  let target: Attackable | undefined = entities.get(targetId)

  if (!target) {
    const tower = towers.get(targetId)
    if (tower && tower.alive && tower.team !== attacker.team) {
      if (canAttackTower && !canAttackTower(tower)) return
      target = tower
    }
  }

  if (!target || !target.alive || target.team === attacker.team) {
    return // invalid target
  }

  if (!attacker.stateMachine.canPerform('attack')) {
    return
  }

  attacker.attackTarget = targetId

  if (isInRange(attacker, target)) {
    // In range — start attacking immediately
    attacker.waypoints = []
    attacker.moveTarget = null
    attacker.facing = facingTo(attacker, target)
    attacker.stateMachine.enterAttacking(attacker.stats.getAttackTimings())
  } else {
    // Out of range — move toward target (move-to-attack)
    // The actual pathfinding will be set by GameState.handleMoveTo
    // We set a flag so updateCombat knows to check range each tick
    attacker.stateMachine.enterMoving()
  }
}

/**
 * Update combat for all entities. Called each tick.
 * Returns damage events that occurred this tick.
 */
export function updateCombat(
  dtMs: number,
  entities: Map<string, ChampionEntity>,
  getAttackable: (id: string) => Attackable | null,
): DamageEvent[] {
  const events: DamageEvent[] = []

  for (const entity of entities.values()) {
    if (!entity.alive) continue

    // --- Move-to-attack: if moving with an attack target, check if in range ---
    if (entity.stateMachine.state === EntityState.Moving && entity.attackTarget) {
      const target = getAttackable(entity.attackTarget)
      if (!target || !target.alive) {
        // Target gone — clear attack target and keep moving
        entity.attackTarget = null
        continue
      }

      if (isInRange(entity, target)) {
        // Arrived in range — stop moving, face target, start attacking
        entity.waypoints = []
        entity.moveTarget = null
        entity.facing = facingTo(entity, target)
        entity.stateMachine.enterAttacking(entity.stats.getAttackTimings())
      }
      // else keep moving toward target
      continue
    }

    // --- Attacking state machine ---
    if (!entity.stateMachine.isAttacking()) continue

    const target = getAttackable(entity.attackTarget ?? '')
    if (!target || !target.alive) {
      // Target dead or gone — go idle
      entity.attackTarget = null
      entity.stateMachine.enterIdle()
      continue
    }

    // During windup: face the target, check range
    if (entity.stateMachine.isInWindup()) {
      entity.facing = facingTo(entity, target)

      if (!isInRange(entity, target)) {
        // Target moved out of range during windup — cancel and chase
        entity.stateMachine.enterMoving()
        continue
      }
    }

    // Tick the state machine
    const tickResult = entity.stateMachine.tick(dtMs)

    // Damage point completed — deal damage
    if (tickResult.completedPhase === AttackPhase.DamagePoint) {
      const dmg = processDamage(entity, target)
      events.push({
        type: 'damage',
        sourceId: entity.id,
        targetId: target.id,
        amount: dmg.finalDamage,
        damageType: dmg.damageType,
        killed: dmg.killed,
      })

      if (dmg.killed) {
        logger.debug(`${entity.id} killed ${target.id} (${dmg.finalDamage.toFixed(1)} dmg)`)
      }
    }

    // Attack cycle complete — auto-attack again or idle
    if (tickResult.attackCycleComplete) {
      if (target.alive && isInRange(entity, target)) {
        // Restart attack cycle
        entity.facing = facingTo(entity, target)
        entity.stateMachine.enterAttacking(entity.stats.getAttackTimings())
      } else if (target.alive && !isInRange(entity, target)) {
        // Target moved out of range — chase
        entity.stateMachine.enterMoving()
      } else {
        // Target dead — idle
        entity.attackTarget = null
        entity.stateMachine.enterIdle()
      }
    }
  }

  return events
}
