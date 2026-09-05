import { Logger } from '@nestjs/common'
import {
  ARAM_MAP,
  BLUE_SPAWN,
  RED_SPAWN,
  DEFAULT_CHAMPION_RADIUS,
  WAYPOINT_REACH_THRESHOLD,
  ClientMessageType,
  EntityState,
  DefaultChampion,
  getChampionDefinition,
  PASSIVE_XP_PER_SECOND,
  KILL_XP_BASE,
  KILL_XP_PER_VICTIM_LEVEL,
  BASE_REGEN_HP_PERCENT_PER_SEC,
  BASE_REGEN_MP_PERCENT_PER_SEC,
  BASE_ZONE_RADIUS,
  TOWER_DEFINITIONS,
  TOWER_STATS,
  NEXUS_STATS,
  respawnTimeMs,
  type TowerTier,
  type MatchConfig,
  type SnapshotPayload,
  type EntitySnapshot,
  type ChampionSnapshot,
  type TowerSnapshot,
  type WorldPosition,
  type MoveToPayload,
  type AttackTargetPayload,
  type GameEvent,
} from '@template-dev/shared'
import { NavigationGrid, findPath, hasLineOfSight } from '@template-dev/shared'
import type { QueuedInput } from './input-queue'
import { ChampionStats } from './champion-stats'
import { EntityStateMachine } from './entity-state-machine'
import { handleAttackCommand, updateCombat } from './combat-system'

// =============================================================================
// Entity interfaces
// =============================================================================

/** Minimal interface for anything that can be targeted by an auto-attack. */
export interface Attackable {
  id: string
  x: number
  y: number
  hp: number
  maxHp: number
  team: 'blue' | 'red'
  alive: boolean
  radius: number
  armor: number
  magicResist: number
}

export interface ChampionEntity extends Attackable {
  playerId: string
  championType: string
  facing: number
  mp: number
  maxMp: number
  moveSpeed: number
  waypoints: WorldPosition[]
  moveTarget: WorldPosition | null
  // Combat
  stats: ChampionStats
  stateMachine: EntityStateMachine
  attackTarget: string | null
  /** ID of the last entity that dealt damage to this entity (for kill credit). */
  lastDamagedBy: string | null
}

export interface TowerEntity extends Attackable {
  tier: TowerTier | 'nexus'
  orderIndex: number
}

export class GameState {
  private readonly logger = new Logger('GameState')
  private entities = new Map<string, ChampionEntity>()
  private towers = new Map<string, TowerEntity>()
  private grid: NavigationGrid
  /** Per-player last processed sequence number */
  private lastProcessedSeq = new Map<string, number>()
  /** Events accumulated during the current tick */
  private pendingEvents: GameEvent[] = []

  constructor(config: MatchConfig) {
    this.grid = new NavigationGrid(ARAM_MAP)

    // Spawn champions
    for (const player of config.players) {
      const spawn = player.team === 'blue' ? BLUE_SPAWN : RED_SPAWN
      const definition = getChampionDefinition(player.championType) ?? DefaultChampion
      const champStats = new ChampionStats(definition)
      const effective = champStats.effectiveStats

      this.logger.log(`Spawning ${player.playerId} as ${definition.name} (${player.championType})`)

      const entity: ChampionEntity = {
        id: `champion_${player.playerId}`,
        playerId: player.playerId,
        championType: player.championType,
        team: player.team,
        x: spawn.x,
        y: spawn.y,
        facing: player.team === 'blue' ? 0 : Math.PI,
        hp: effective.hp,
        maxHp: effective.hp,
        mp: effective.mp,
        maxMp: effective.mp,
        moveSpeed: effective.moveSpeed,
        radius: DEFAULT_CHAMPION_RADIUS,
        armor: effective.armor,
        magicResist: effective.magicResist,
        alive: true,
        waypoints: [],
        moveTarget: null,
        stats: champStats,
        stateMachine: new EntityStateMachine(),
        attackTarget: null,
        lastDamagedBy: null,
      }
      this.entities.set(entity.id, entity)
      this.lastProcessedSeq.set(player.playerId, 0)
    }

    // Spawn towers & nexuses
    for (const def of TOWER_DEFINITIONS) {
      const stats = def.tier === 'nexus' ? NEXUS_STATS : TOWER_STATS[def.tier]
      const tower: TowerEntity = {
        id: def.id,
        team: def.team,
        tier: def.tier,
        x: def.position.x,
        y: def.position.y,
        hp: stats.hp,
        maxHp: stats.hp,
        alive: true,
        radius: def.radius,
        armor: stats.armor,
        magicResist: stats.magicResist,
        orderIndex: def.orderIndex,
      }
      this.towers.set(tower.id, tower)
    }
  }

  getEntities(): Map<string, ChampionEntity> {
    return this.entities
  }

  getTowers(): Map<string, TowerEntity> {
    return this.towers
  }

  /** Look up any attackable entity (champion or tower) by ID. */
  getAttackable(id: string): Attackable | null {
    return this.entities.get(id) ?? this.towers.get(id) ?? null
  }

  /** Check if a tower can be attacked (destruction order enforcement). */
  canAttackTower(attackerTeam: 'blue' | 'red', tower: TowerEntity): boolean {
    if (tower.team === attackerTeam) return false
    if (tower.orderIndex === 0) return true // outer tower always attackable
    // Previous tower in the order must be destroyed first
    for (const t of this.towers.values()) {
      if (t.team === tower.team && t.orderIndex === tower.orderIndex - 1 && t.alive) {
        return false
      }
    }
    return true
  }

  // ===========================================================================
  // Input processing
  // ===========================================================================

  processInputs(inputs: QueuedInput[]): void {
    for (const input of inputs) {
      const entityId = `champion_${input.playerId}`
      const entity = this.entities.get(entityId)
      if (!entity || !entity.alive) continue

      // Track last processed seq
      this.lastProcessedSeq.set(input.playerId, input.sequenceNumber)

      switch (input.type) {
        case ClientMessageType.MOVE_TO: {
          if (!entity.stateMachine.canPerform('move')) break
          const payload = input.payload as MoveToPayload
          entity.attackTarget = null // cancel attack on move
          entity.stateMachine.enterMoving()
          this.handleMoveTo(entity, payload)
          break
        }
        case ClientMessageType.STOP: {
          if (!entity.stateMachine.canPerform('stop')) break
          entity.waypoints = []
          entity.moveTarget = null
          entity.attackTarget = null
          entity.stateMachine.enterIdle()
          break
        }
        case ClientMessageType.ATTACK_TARGET: {
          const payload = input.payload as AttackTargetPayload
          handleAttackCommand(entity, payload.targetEntityId, this.entities, this.towers, (tower) =>
            this.canAttackTower(entity.team, tower),
          )
          // If the entity needs to move to attack target, do pathfinding
          if (entity.stateMachine.state === EntityState.Moving && entity.attackTarget) {
            const target = this.getAttackable(entity.attackTarget)
            if (target) {
              this.handleMoveTo(entity, { x: target.x, y: target.y })
            }
          }
          break
        }
      }
    }
  }

  private handleMoveTo(entity: ChampionEntity, payload: MoveToPayload): void {
    const targetPos: WorldPosition = { x: payload.x, y: payload.y }
    const entityPos: WorldPosition = { x: entity.x, y: entity.y }

    // Check line of sight first
    const fromGrid = this.grid.worldToGrid(entityPos)
    const toGrid = this.grid.worldToGrid(targetPos)
    if (hasLineOfSight(this.grid, fromGrid, toGrid)) {
      entity.waypoints = [targetPos]
      entity.moveTarget = targetPos
      return
    }

    // Use A* pathfinding
    const path = findPath(this.grid, entityPos, targetPos)
    if (path && path.length > 0) {
      entity.waypoints = path
      entity.moveTarget = targetPos

      // Skip first waypoint if very close to current position
      if (entity.waypoints.length > 1) {
        const first = entity.waypoints[0]
        const dx = first.x - entity.x
        const dy = first.y - entity.y
        if (dx * dx + dy * dy < 100) {
          entity.waypoints.shift()
        }
      }
    } else {
      entity.waypoints = []
      entity.moveTarget = null
      // No valid path — revert to idle so future commands aren't blocked
      if (!entity.attackTarget) {
        entity.stateMachine.enterIdle()
      }
    }
  }

  // ===========================================================================
  // Movement
  // ===========================================================================

  updateMovement(dtSeconds: number): void {
    for (const entity of this.entities.values()) {
      if (!entity.alive || entity.waypoints.length === 0) continue
      // Don't move during windup/damage point — but allow movement during recovery
      if (entity.stateMachine.isAttacking() && !entity.stateMachine.canPerform('move')) continue

      const target = entity.waypoints[0]
      const dx = target.x - entity.x
      const dy = target.y - entity.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < WAYPOINT_REACH_THRESHOLD) {
        entity.waypoints.shift()
        if (entity.waypoints.length === 0) {
          entity.moveTarget = null
          // If no attack target, go idle
          if (!entity.attackTarget) {
            entity.stateMachine.enterIdle()
          }
        }
        continue
      }

      // Update facing — use the actual movement direction (dx/dy toward
      // current waypoint) for smooth, jitter-free rotation instead of
      // snapping toward the final destination each tick.
      const targetFacing = Math.atan2(dy, dx)
      // Lerp the angle to avoid snapping
      let facingDiff = targetFacing - entity.facing
      while (facingDiff > Math.PI) facingDiff -= 2 * Math.PI
      while (facingDiff < -Math.PI) facingDiff += 2 * Math.PI
      const facingLerp = Math.min(1, 15 * dtSeconds)
      entity.facing += facingDiff * facingLerp

      // Move toward waypoint
      const step = entity.moveSpeed * dtSeconds
      if (step >= dist) {
        entity.x = target.x
        entity.y = target.y
        entity.waypoints.shift()
        if (entity.waypoints.length === 0) {
          entity.moveTarget = null
          if (!entity.attackTarget) {
            entity.stateMachine.enterIdle()
          }
        }
      } else {
        entity.x += (dx / dist) * step
        entity.y += (dy / dist) * step
      }
    }

    // Update move-to-attack pathfinding: re-target entities chasing an attack target
    for (const entity of this.entities.values()) {
      if (!entity.alive || entity.stateMachine.state !== EntityState.Moving) continue
      if (entity.waypoints.length > 0) continue

      if (entity.attackTarget) {
        const target = this.getAttackable(entity.attackTarget)
        if (target && target.alive) {
          this.handleMoveTo(entity, { x: target.x, y: target.y })
        } else {
          entity.attackTarget = null
          entity.stateMachine.enterIdle()
        }
      } else {
        // Safety: Moving with no waypoints and no attack target → go idle
        entity.stateMachine.enterIdle()
      }
    }
  }

  // ===========================================================================
  // Combat
  // ===========================================================================

  updateCombat(dtMs: number): void {
    const damageEvents = updateCombat(dtMs, this.entities, (id) => this.getAttackable(id))

    for (const event of damageEvents) {
      this.pendingEvents.push(event)

      // Track last damaged by (for kill credit — champions only)
      const target = this.entities.get(event.targetId)
      if (target) {
        target.lastDamagedBy = event.sourceId
      }
    }
  }

  // ===========================================================================
  // Death & Respawn
  // ===========================================================================

  checkDeathAndRespawn(dtMs: number): void {
    // --- Champion death & respawn ---
    for (const entity of this.entities.values()) {
      // Tick dead entity state machines (respawn timer countdown)
      if (entity.stateMachine.isDead()) {
        entity.stateMachine.tick(dtMs)
      }

      // --- Death check ---
      if (entity.hp <= 0 && entity.alive) {
        entity.alive = false
        entity.waypoints = []
        entity.moveTarget = null
        entity.attackTarget = null

        const timer = respawnTimeMs(entity.stats.level)
        entity.stateMachine.enterDead(timer)

        // Award kill XP
        if (entity.lastDamagedBy) {
          const killer = this.entities.get(entity.lastDamagedBy)
          if (killer && killer.alive) {
            const xpGain = KILL_XP_BASE + KILL_XP_PER_VICTIM_LEVEL * entity.stats.level
            const levelsGained = killer.stats.addXp(xpGain)
            if (levelsGained > 0) {
              this.syncChampionStats(killer)
              this.pendingEvents.push({
                type: 'levelUp',
                entityId: killer.id,
                newLevel: killer.stats.level,
              })
            }
          }
        }

        entity.lastDamagedBy = null
        this.logger.log(`${entity.id} died (respawn in ${timer / 1000}s)`)
      }

      // --- Respawn check ---
      if (entity.stateMachine.isDead() && entity.stateMachine.respawnTimerMs <= 0) {
        const spawn = entity.team === 'blue' ? BLUE_SPAWN : RED_SPAWN
        entity.x = spawn.x
        entity.y = spawn.y
        entity.alive = true

        const effective = entity.stats.effectiveStats
        entity.hp = effective.hp
        entity.maxHp = effective.hp
        entity.mp = effective.mp
        entity.maxMp = effective.mp
        entity.moveSpeed = effective.moveSpeed
        entity.armor = effective.armor
        entity.magicResist = effective.magicResist

        entity.stateMachine.enterIdle()

        this.pendingEvents.push({
          type: 'respawn',
          entityId: entity.id,
          x: spawn.x,
          y: spawn.y,
        })

        this.logger.log(`${entity.id} respawned`)
      }
    }

    // --- Tower death (no respawn) ---
    for (const tower of this.towers.values()) {
      if (tower.hp <= 0 && tower.alive) {
        tower.alive = false

        // Unblock pathfinding cells
        this.grid.unblockCircle({ x: tower.x, y: tower.y }, tower.radius)

        // Clear attack targets pointing at this tower
        for (const entity of this.entities.values()) {
          if (entity.attackTarget === tower.id) {
            entity.attackTarget = null
            if (entity.stateMachine.isAttacking()) {
              entity.stateMachine.enterIdle()
            }
          }
        }

        this.pendingEvents.push({
          type: 'towerDestroyed',
          entityId: tower.id,
          team: tower.team,
          tier: tower.tier,
        })

        this.logger.log(`${tower.id} destroyed`)
      }
    }
  }

  /** Sync champion cached stats after a level-up. */
  private syncChampionStats(entity: ChampionEntity): void {
    const newStats = entity.stats.effectiveStats
    const hpDiff = newStats.hp - entity.maxHp
    const mpDiff = newStats.mp - entity.maxMp
    entity.maxHp = newStats.hp
    entity.maxMp = newStats.mp
    entity.hp = Math.min(entity.hp + hpDiff, entity.maxHp)
    entity.mp = Math.min(entity.mp + mpDiff, entity.maxMp)
    entity.moveSpeed = newStats.moveSpeed
    entity.armor = newStats.armor
    entity.magicResist = newStats.magicResist
  }

  // ===========================================================================
  // XP & Regeneration
  // ===========================================================================

  updateRegenAndXp(dtSeconds: number): void {
    for (const entity of this.entities.values()) {
      if (!entity.alive) continue

      // --- Passive XP ---
      const xpGain = PASSIVE_XP_PER_SECOND * dtSeconds
      const levelsGained = entity.stats.addXp(xpGain)
      if (levelsGained > 0) {
        this.syncChampionStats(entity)
        this.pendingEvents.push({
          type: 'levelUp',
          entityId: entity.id,
          newLevel: entity.stats.level,
        })
      }

      // --- Regeneration ---
      const spawn = entity.team === 'blue' ? BLUE_SPAWN : RED_SPAWN
      const dx = entity.x - spawn.x
      const dy = entity.y - spawn.y
      const distToSpawn = Math.sqrt(dx * dx + dy * dy)
      const inBase = distToSpawn <= BASE_ZONE_RADIUS

      if (inBase) {
        // Fast base regen
        entity.hp += entity.maxHp * BASE_REGEN_HP_PERCENT_PER_SEC * dtSeconds
        entity.mp += entity.maxMp * BASE_REGEN_MP_PERCENT_PER_SEC * dtSeconds
      } else {
        // Natural regen from stats
        entity.hp += entity.stats.effectiveStats.hpRegen * dtSeconds
        entity.mp += entity.stats.effectiveStats.mpRegen * dtSeconds
      }

      // Clamp
      entity.hp = Math.min(entity.hp, entity.maxHp)
      entity.mp = Math.min(entity.mp, entity.maxMp)
    }
  }

  // ===========================================================================
  // Snapshot
  // ===========================================================================

  captureSnapshot(tick: number, gameTimeMs: number): SnapshotPayload {
    const entities: EntitySnapshot[] = []

    // Champions
    for (const entity of this.entities.values()) {
      const effective = entity.stats.effectiveStats

      const snap: ChampionSnapshot = {
        id: entity.id,
        type: 'champion',
        x: entity.x,
        y: entity.y,
        facing: entity.facing,
        hp: entity.hp,
        maxHp: entity.maxHp,
        mp: entity.mp,
        maxMp: entity.maxMp,
        team: entity.team,
        alive: entity.alive,
        // Champion identity
        championType: entity.championType,
        // Combat state
        state: entity.stateMachine.state,
        attackPhase: entity.stateMachine.isAttacking()
          ? entity.stateMachine.attackPhase
          : undefined,
        attackTargetId: entity.attackTarget ?? undefined,
        // Stats
        level: entity.stats.level,
        xp: entity.stats.xp,
        xpToNextLevel: entity.stats.xpToNextLevel,
        ad: effective.ad,
        ap: effective.ap,
        armor: effective.armor,
        magicResist: effective.magicResist,
        attackSpeed: effective.attackSpeed,
        moveSpeed: effective.moveSpeed,
        attackRange: effective.attackRange,
        hpRegen: effective.hpRegen,
        mpRegen: effective.mpRegen,
        critChance: effective.critChance,
        // Death
        respawnTimerMs: entity.stateMachine.isDead()
          ? entity.stateMachine.respawnTimerMs
          : undefined,
      }
      entities.push(snap)
    }

    // Towers & Nexuses
    for (const tower of this.towers.values()) {
      const snap: TowerSnapshot = {
        id: tower.id,
        type: 'tower',
        x: tower.x,
        y: tower.y,
        hp: tower.hp,
        maxHp: tower.maxHp,
        team: tower.team,
        alive: tower.alive,
        tier: tower.tier,
        radius: tower.radius,
        armor: tower.armor,
        magicResist: tower.magicResist,
        orderIndex: tower.orderIndex,
      }
      entities.push(snap)
    }

    const lastProcessedSeq: Record<string, number> = {}
    for (const [playerId, seq] of this.lastProcessedSeq) {
      lastProcessedSeq[playerId] = seq
    }

    // Drain pending events
    const events = [...this.pendingEvents]
    this.pendingEvents = []

    return { entities, lastProcessedSeq, gameTimeMs, events }
  }
}
