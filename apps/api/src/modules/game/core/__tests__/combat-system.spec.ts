import { describe, it, expect, beforeEach } from 'vitest'
import {
  type MatchConfig,
  type ChampionSnapshot,
  TICK_DURATION_MS,
  TICK_DURATION_S,
  BLUE_SPAWN,
  RED_SPAWN,
  applyResistance,
  EntityState,
  AttackPhase,
  PASSIVE_XP_PER_SECOND,
  xpRequiredForLevel,
  respawnTimeMs,
} from '@template-dev/shared'
import { GameState } from '../game-state'
import type { QueuedInput } from '../input-queue'
import { ClientMessageType } from '@template-dev/shared'

function makeConfig(): MatchConfig {
  return {
    matchId: 'test-match',
    players: [
      { playerId: 'p1', team: 'blue', championType: 'default' },
      { playerId: 'p2', team: 'red', championType: 'default' },
    ],
  }
}

function makeAttackInput(playerId: string, targetEntityId: string, seq = 1): QueuedInput {
  return {
    playerId,
    type: ClientMessageType.ATTACK_TARGET,
    payload: { targetEntityId },
    receivedAt: performance.now(),
    clientTick: 0,
    sequenceNumber: seq,
  }
}

function makeMoveInput(playerId: string, x: number, y: number, seq = 1): QueuedInput {
  return {
    playerId,
    type: ClientMessageType.MOVE_TO,
    payload: { x, y },
    receivedAt: performance.now(),
    clientTick: 0,
    sequenceNumber: seq,
  }
}

function makeStopInput(playerId: string, seq = 1): QueuedInput {
  return {
    playerId,
    type: ClientMessageType.STOP,
    payload: {},
    receivedAt: performance.now(),
    clientTick: 0,
    sequenceNumber: seq,
  }
}

/**
 * Simulate N ticks of the game loop (simplified, without actual GameLoop).
 */
function simulateTicks(state: GameState, count: number) {
  for (let i = 0; i < count; i++) {
    state.updateMovement(TICK_DURATION_S)
    state.updateCombat(TICK_DURATION_MS)
    state.updateRegenAndXp(TICK_DURATION_S)
    state.checkDeathAndRespawn(TICK_DURATION_MS)
    // drain events by capturing snapshot
    state.captureSnapshot(i, i * TICK_DURATION_MS)
  }
}

describe('CombatSystem - Integration', () => {
  let state: GameState

  beforeEach(() => {
    state = new GameState(makeConfig())
  })

  describe('Champion Initialization', () => {
    it('spawns champions with correct base stats', () => {
      const entities = state.getEntities()
      const p1 = entities.get('champion_p1')!
      const p2 = entities.get('champion_p2')!

      expect(p1.hp).toBe(600)
      expect(p1.maxHp).toBe(600)
      expect(p1.mp).toBe(400)
      expect(p1.alive).toBe(true)
      expect(p1.stats.level).toBe(1)
      expect(p1.stats.effectiveStats.ad).toBe(60)
      expect(p1.stats.effectiveStats.armor).toBe(30)

      expect(p2.x).toBe(RED_SPAWN.x)
      expect(p2.y).toBe(RED_SPAWN.y)
    })

    it('starts in idle state', () => {
      const p1 = state.getEntities().get('champion_p1')!
      expect(p1.stateMachine.state).toBe(EntityState.Idle)
    })
  })

  describe('Attack Command', () => {
    it('transitions to attacking when target is in range', () => {
      const entities = state.getEntities()
      const p1 = entities.get('champion_p1')!
      const p2 = entities.get('champion_p2')!

      // Place champions close together (within melee range: 125 + 50 radius = 175)
      p1.x = 500
      p1.y = 600
      p2.x = 650
      p2.y = 600

      state.processInputs([makeAttackInput('p1', 'champion_p2')])

      expect(p1.stateMachine.state).toBe(EntityState.Attacking)
      expect(p1.attackTarget).toBe('champion_p2')
    })

    it('moves toward target when out of range', () => {
      // Champions start at opposite ends (far apart)
      state.processInputs([makeAttackInput('p1', 'champion_p2')])

      const p1 = state.getEntities().get('champion_p1')!
      expect(p1.stateMachine.state).toBe(EntityState.Moving)
      expect(p1.attackTarget).toBe('champion_p2')
    })

    it('ignores attack on ally', () => {
      // p1 is blue, champion_p1 is also "self" — can't attack
      const p1 = state.getEntities().get('champion_p1')!
      const prevState = p1.stateMachine.state

      state.processInputs([makeAttackInput('p1', 'champion_p1')])

      expect(p1.stateMachine.state).toBe(prevState) // no change
    })
  })

  describe('Damage Pipeline', () => {
    it('deals correct physical damage (60 AD vs 30 armor)', () => {
      const entities = state.getEntities()
      const p1 = entities.get('champion_p1')!
      const p2 = entities.get('champion_p2')!

      // Place close together
      p1.x = 3000
      p1.y = 600
      p2.x = 3120
      p2.y = 600

      state.processInputs([makeAttackInput('p1', 'champion_p2')])

      // Expected damage: 60 * (100 / 130) ≈ 46.15
      const expectedDamage = applyResistance(60, 30)

      // Simulate until first damage event
      let damageAmount = 0
      for (let i = 0; i < 25; i++) {
        state.updateMovement(TICK_DURATION_S)
        state.updateCombat(TICK_DURATION_MS)
        state.updateRegenAndXp(TICK_DURATION_S)
        state.checkDeathAndRespawn(TICK_DURATION_MS)
        const snapshot = state.captureSnapshot(i, i * TICK_DURATION_MS)

        const dmgEvents = snapshot.events.filter((e) => e.type === 'damage')
        if (dmgEvents.length > 0) {
          damageAmount = (dmgEvents[0] as { amount: number }).amount
          break
        }
      }

      // Verify the damage event amount matches the formula
      expect(damageAmount).toBeCloseTo(expectedDamage, 1)
    })

    it('emits damage event in snapshot', () => {
      const entities = state.getEntities()
      const p1 = entities.get('champion_p1')!
      const p2 = entities.get('champion_p2')!

      p1.x = 500
      p1.y = 600
      p2.x = 620
      p2.y = 600

      state.processInputs([makeAttackInput('p1', 'champion_p2')])

      // Simulate until damage point is reached
      let damageEventFound = false
      for (let i = 0; i < 25; i++) {
        state.updateMovement(TICK_DURATION_S)
        state.updateCombat(TICK_DURATION_MS)
        state.updateRegenAndXp(TICK_DURATION_S)
        state.checkDeathAndRespawn(TICK_DURATION_MS)
        const snapshot = state.captureSnapshot(i, i * TICK_DURATION_MS)

        const dmgEvents = snapshot.events.filter((e) => e.type === 'damage')
        if (dmgEvents.length > 0) {
          damageEventFound = true
          expect(dmgEvents[0].sourceId).toBe('champion_p1')
          expect(dmgEvents[0].targetId).toBe('champion_p2')
          expect(dmgEvents[0].damageType).toBe('physical')
          expect(dmgEvents[0].amount).toBeGreaterThan(0)
          break
        }
      }

      expect(damageEventFound).toBe(true)
    })
  })

  describe('Auto-Attack Repeat', () => {
    it('continues auto-attacking after recovery', () => {
      const entities = state.getEntities()
      const p1 = entities.get('champion_p1')!
      const p2 = entities.get('champion_p2')!

      p1.x = 500
      p1.y = 600
      p2.x = 620
      p2.y = 600

      state.processInputs([makeAttackInput('p1', 'champion_p2')])

      // Simulate 60 ticks (~2 seconds) — should land multiple auto-attacks
      // Attack cycle = 1600ms → should get at least 1 full cycle
      let totalDamageEvents = 0
      for (let i = 0; i < 60; i++) {
        state.updateMovement(TICK_DURATION_S)
        state.updateCombat(TICK_DURATION_MS)
        state.updateRegenAndXp(TICK_DURATION_S)
        state.checkDeathAndRespawn(TICK_DURATION_MS)
        const snapshot = state.captureSnapshot(i, i * TICK_DURATION_MS)
        totalDamageEvents += snapshot.events.filter((e) => e.type === 'damage').length
      }

      expect(totalDamageEvents).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Cancel Attack on Move', () => {
    it('cancels windup when move command is issued', () => {
      const entities = state.getEntities()
      const p1 = entities.get('champion_p1')!
      const p2 = entities.get('champion_p2')!

      p1.x = 500
      p1.y = 600
      p2.x = 620
      p2.y = 600

      state.processInputs([makeAttackInput('p1', 'champion_p2')])
      expect(p1.stateMachine.state).toBe(EntityState.Attacking)

      // Immediately issue move (during windup)
      state.processInputs([makeMoveInput('p1', 300, 600, 2)])
      expect(p1.stateMachine.state).toBe(EntityState.Moving)
      expect(p1.attackTarget).toBeNull()
    })
  })

  describe('Death and Respawn', () => {
    it('kills a champion when HP reaches 0', () => {
      const entities = state.getEntities()
      const p2 = entities.get('champion_p2')!

      // Force HP to 0
      p2.hp = 0
      p2.lastDamagedBy = 'champion_p1'

      state.checkDeathAndRespawn(TICK_DURATION_MS)

      expect(p2.alive).toBe(false)
      expect(p2.stateMachine.state).toBe(EntityState.Dead)
    })

    it('respawns after timer expires', () => {
      const entities = state.getEntities()
      const p2 = entities.get('champion_p2')!

      p2.hp = 0
      p2.lastDamagedBy = 'champion_p1'

      state.checkDeathAndRespawn(TICK_DURATION_MS)
      expect(p2.alive).toBe(false)

      // Respawn timer for level 1 = 12s = 12000ms → ~360 ticks
      const respawnTicks = Math.ceil(respawnTimeMs(1) / TICK_DURATION_MS) + 2

      for (let i = 0; i < respawnTicks; i++) {
        state.updateMovement(TICK_DURATION_S)
        state.updateCombat(TICK_DURATION_MS)
        state.updateRegenAndXp(TICK_DURATION_S)
        state.checkDeathAndRespawn(TICK_DURATION_MS)
      }

      expect(p2.alive).toBe(true)
      expect(p2.hp).toBe(p2.maxHp)
      expect(p2.x).toBe(RED_SPAWN.x)
      expect(p2.y).toBe(RED_SPAWN.y)
    })

    it('awards kill XP to the killer', () => {
      const entities = state.getEntities()
      const p1 = entities.get('champion_p1')!
      const p2 = entities.get('champion_p2')!

      const xpBefore = p1.stats.xp

      p2.hp = 0
      p2.lastDamagedBy = 'champion_p1'

      state.checkDeathAndRespawn(TICK_DURATION_MS)

      // Kill XP = 200 + 50 * 1 (victim level) = 250
      expect(p1.stats.xp).toBeGreaterThan(xpBefore)
      expect(p1.stats.xp - xpBefore).toBe(250)
    })
  })

  describe('XP and Leveling', () => {
    it('gains passive XP over time', () => {
      const p1 = state.getEntities().get('champion_p1')!
      const xpBefore = p1.stats.xp

      // Simulate 1 second (30 ticks)
      for (let i = 0; i < 30; i++) {
        state.updateRegenAndXp(TICK_DURATION_S)
      }

      // Should have gained ~5 XP (PASSIVE_XP_PER_SECOND * 1s)
      expect(p1.stats.xp - xpBefore).toBeCloseTo(PASSIVE_XP_PER_SECOND, 0)
    })

    it('levels up when XP threshold is reached', () => {
      const p1 = state.getEntities().get('champion_p1')!
      expect(p1.stats.level).toBe(1)

      // Manually add enough XP for level 2 (280 XP)
      const oldMaxHp = p1.maxHp
      p1.stats.addXp(xpRequiredForLevel(2))

      // The level-up side effects (maxHp update) happen in updateRegenAndXp
      // but addXp already updates the level
      expect(p1.stats.level).toBe(2)
      expect(p1.stats.effectiveStats.hp).toBeGreaterThan(oldMaxHp)
    })
  })

  describe('Regeneration', () => {
    it('regenerates HP in base', () => {
      const p1 = state.getEntities().get('champion_p1')!
      // p1 spawns at BLUE_SPAWN which is in base zone
      p1.hp = 300

      state.updateRegenAndXp(1) // 1 second

      // Base regen: 10% of 600 maxHP = 60 HP/sec
      expect(p1.hp).toBeCloseTo(360, 0)
    })

    it('regenerates HP slowly out of base', () => {
      const p1 = state.getEntities().get('champion_p1')!
      p1.x = 3000 // center of map, far from base
      p1.y = 600
      p1.hp = 300

      state.updateRegenAndXp(1) // 1 second

      // Natural regen: hpRegen = 8 per second
      expect(p1.hp).toBeCloseTo(308, 0)
    })

    it('does not regenerate above max HP', () => {
      const p1 = state.getEntities().get('champion_p1')!
      p1.hp = p1.maxHp

      state.updateRegenAndXp(1)

      expect(p1.hp).toBe(p1.maxHp)
    })
  })

  describe('Snapshot', () => {
    it('captures combat state in snapshot', () => {
      const entities = state.getEntities()
      const p1 = entities.get('champion_p1')!
      const p2 = entities.get('champion_p2')!

      p1.x = 500
      p1.y = 600
      p2.x = 620
      p2.y = 600

      state.processInputs([makeAttackInput('p1', 'champion_p2')])

      const snapshot = state.captureSnapshot(1, TICK_DURATION_MS)
      const p1Snap = snapshot.entities.find((e) => e.id === 'champion_p1')! as ChampionSnapshot

      expect(p1Snap.state).toBe(EntityState.Attacking)
      expect(p1Snap.attackPhase).toBe(AttackPhase.Windup)
      expect(p1Snap.attackTargetId).toBe('champion_p2')
      expect(p1Snap.level).toBe(1)
      expect(p1Snap.ad).toBe(60)
      expect(p1Snap.armor).toBe(30)
      expect(p1Snap.mp).toBe(400)
      expect(p1Snap.maxMp).toBe(400)
      expect(snapshot.events).toBeDefined()
    })
  })

  describe('Tower Combat', () => {
    it('can attack enemy outer tower', () => {
      const entities = state.getEntities()
      const p1 = entities.get('champion_p1')! // blue team

      // Move blue champion near red outer tower (x: 3900)
      p1.x = 3780
      p1.y = 600

      state.processInputs([makeAttackInput('p1', 'tower_red_0')])

      expect(p1.stateMachine.state).toBe(EntityState.Attacking)
      expect(p1.attackTarget).toBe('tower_red_0')
    })

    it('cannot attack own tower', () => {
      const entities = state.getEntities()
      const p1 = entities.get('champion_p1')! // blue team

      // Move near own tower
      p1.x = 2000
      p1.y = 600

      state.processInputs([makeAttackInput('p1', 'tower_blue_0')])

      expect(p1.stateMachine.state).toBe(EntityState.Idle)
      expect(p1.attackTarget).toBeNull()
    })

    it('cannot attack inner tower while outer is alive', () => {
      const entities = state.getEntities()
      const p1 = entities.get('champion_p1')!

      // Move near red inner tower
      p1.x = 4380
      p1.y = 600

      state.processInputs([makeAttackInput('p1', 'tower_red_1')])

      // Should not attack because outer tower is still alive
      expect(p1.stateMachine.state).toBe(EntityState.Idle)
      expect(p1.attackTarget).toBeNull()
    })

    it('can attack inner tower after outer is destroyed', () => {
      const entities = state.getEntities()
      const towers = state.getTowers()
      const p1 = entities.get('champion_p1')!

      // Destroy outer red tower
      const outerTower = towers.get('tower_red_0')!
      outerTower.hp = 0
      state.checkDeathAndRespawn(TICK_DURATION_MS)
      expect(outerTower.alive).toBe(false)

      // Now try to attack inner tower
      p1.x = 4380
      p1.y = 600
      state.processInputs([makeAttackInput('p1', 'tower_red_1')])

      expect(p1.stateMachine.state).toBe(EntityState.Attacking)
      expect(p1.attackTarget).toBe('tower_red_1')
    })

    it('deals damage to tower and emits damage event', () => {
      const entities = state.getEntities()
      const towers = state.getTowers()
      const p1 = entities.get('champion_p1')!
      const tower = towers.get('tower_red_0')!

      const initialHp = tower.hp

      // Position in range
      p1.x = 3780
      p1.y = 600

      state.processInputs([makeAttackInput('p1', 'tower_red_0')])

      // Simulate until damage is dealt
      let damageDealt = false
      for (let i = 0; i < 25; i++) {
        state.updateMovement(TICK_DURATION_S)
        state.updateCombat(TICK_DURATION_MS)
        state.updateRegenAndXp(TICK_DURATION_S)
        state.checkDeathAndRespawn(TICK_DURATION_MS)
        const snapshot = state.captureSnapshot(i, i * TICK_DURATION_MS)

        const dmgEvents = snapshot.events.filter(
          (e) => e.type === 'damage' && e.targetId === 'tower_red_0',
        )
        if (dmgEvents.length > 0) {
          damageDealt = true
          break
        }
      }

      expect(damageDealt).toBe(true)
      expect(tower.hp).toBeLessThan(initialHp)
    })

    it('emits towerDestroyed event when tower dies', () => {
      const towers = state.getTowers()
      const tower = towers.get('tower_red_0')!

      tower.hp = 0
      state.checkDeathAndRespawn(TICK_DURATION_MS)

      const snapshot = state.captureSnapshot(0, 0)
      const destroyedEvents = snapshot.events.filter((e) => e.type === 'towerDestroyed')

      expect(destroyedEvents.length).toBe(1)
      expect(destroyedEvents[0].entityId).toBe('tower_red_0')
      expect(tower.alive).toBe(false)
    })

    it('tower does not respawn', () => {
      const towers = state.getTowers()
      const tower = towers.get('tower_red_0')!

      tower.hp = 0
      state.checkDeathAndRespawn(TICK_DURATION_MS)
      state.captureSnapshot(0, 0) // drain events

      // Simulate many ticks
      simulateTicks(state, 1000)

      expect(tower.alive).toBe(false)
    })

    it('clears attack target when tower is destroyed', () => {
      const entities = state.getEntities()
      const towers = state.getTowers()
      const p1 = entities.get('champion_p1')!
      const tower = towers.get('tower_red_0')!

      p1.x = 3780
      p1.y = 600
      state.processInputs([makeAttackInput('p1', 'tower_red_0')])
      expect(p1.attackTarget).toBe('tower_red_0')

      // Kill the tower
      tower.hp = 0
      state.checkDeathAndRespawn(TICK_DURATION_MS)

      expect(p1.attackTarget).toBeNull()
    })

    it('includes towers in snapshot', () => {
      const snapshot = state.captureSnapshot(0, 0)
      const towerSnaps = snapshot.entities.filter((e) => e.type === 'tower')

      // 6 towers + 2 nexuses = 8
      expect(towerSnaps.length).toBe(8)

      const outerRed = towerSnaps.find((e) => e.id === 'tower_red_0')!
      expect(outerRed.hp).toBe(3500)
      expect(outerRed.team).toBe('red')
      expect(outerRed.alive).toBe(true)
    })
  })
})
