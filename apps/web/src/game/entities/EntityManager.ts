import type * as THREE from 'three'
import {
  COLORS,
  DEFAULT_CHAMPION_RADIUS,
  type EntitySnapshot,
  type ChampionSnapshot,
  type TowerSnapshot,
  type GameEvent,
  type Team,
} from '@template-dev/shared'
import { ChampionRenderer3D } from '../rendering/ChampionRenderer3D'
import { TowerRenderer3D } from '../rendering/TowerRenderer3D'
import { HealthBar } from '../rendering/HealthBar'
import { LevelBadge } from '../rendering/LevelBadge'
import { DamageNumberManager } from '../rendering/DamageNumber'

interface EntityView {
  id: string
  type: 'champion' | 'tower'
  renderer: ChampionRenderer3D | TowerRenderer3D
  healthBar: HealthBar
  levelBadge: LevelBadge | null
  team: Team
  /** Hit radius for this entity (used for damage number offset). */
  radius: number
  /** Previous alive state for detecting death/respawn transitions. */
  wasAlive: boolean
  /** Previous HP for detecting damage taken. */
  prevHp: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a
  // Normalize to [-PI, PI]
  while (diff > Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI
  return a + diff * t
}

export class EntityManager {
  private entities = new Map<string, EntityView>()
  private damageNumbers: DamageNumberManager
  /** Cache of the latest "to" snapshot for hit testing. */
  private latestSnapshot: EntitySnapshot[] = []

  constructor(private readonly scene: THREE.Scene) {
    this.damageNumbers = new DamageNumberManager(scene)
  }

  /**
   * Update all entity visuals by interpolating between two snapshots.
   */
  update(
    fromEntities: EntitySnapshot[],
    toEntities: EntitySnapshot[],
    alpha: number,
    dt: number,
    events?: GameEvent[],
  ): void {
    this.latestSnapshot = toEntities
    const activeIds = new Set<string>()

    for (const toEntity of toEntities) {
      activeIds.add(toEntity.id)

      let view = this.entities.get(toEntity.id)
      if (!view) {
        view = this.createEntity(toEntity)
        this.entities.set(toEntity.id, view)
      }

      // Find matching entity in "from" snapshot
      const fromEntity = fromEntities.find((e) => e.id === toEntity.id)

      let x: number, y: number
      if (fromEntity) {
        x = lerp(fromEntity.x, toEntity.x, alpha)
        y = lerp(fromEntity.y, toEntity.y, alpha)
      } else {
        x = toEntity.x
        y = toEntity.y
      }

      view.renderer.setPosition({ x, y })
      view.renderer.updateFlash(dt)
      view.healthBar.update(toEntity.hp / toEntity.maxHp)

      // Champion-specific updates
      if (toEntity.type === 'champion') {
        const fromChamp = fromEntity as ChampionSnapshot | undefined
        const facing = fromChamp
          ? lerpAngle(fromChamp.facing, toEntity.facing, alpha)
          : toEntity.facing
        view.renderer.setFacing(facing)
        view.levelBadge?.setLevel(toEntity.level)

        // Attack animation
        if (toEntity.state === 'attacking' && toEntity.attackPhase) {
          view.renderer.setAttacking(true, toEntity.attackPhase)
        } else {
          view.renderer.setAttacking(false)
        }

        // Update GLB animation (if loaded)
        if (view.renderer instanceof ChampionRenderer3D) {
          view.renderer.updateAnimation(dt)
        }
      }

      // --- Combat visual feedback ---

      // Death/respawn transitions
      if (toEntity.alive && !view.wasAlive) {
        view.renderer.setDead(false)
      } else if (!toEntity.alive && view.wasAlive) {
        view.renderer.setDead(true)
      }

      // Damage flash (HP decreased)
      if (toEntity.hp < view.prevHp && toEntity.alive) {
        view.renderer.flashDamage()
      }

      // Always show entity (alive or dead with death visual)
      view.renderer.group.visible = true

      view.wasAlive = toEntity.alive
      view.prevHp = toEntity.hp
    }

    // Spawn damage numbers from events
    if (events) {
      for (const event of events) {
        if (event.type === 'damage') {
          const targetView = this.entities.get(event.targetId)
          if (targetView) {
            this.damageNumbers.spawn(
              targetView.renderer.group.position.x,
              targetView.renderer.group.position.z, // game Y = Three.js Z
              event.amount,
              event.damageType,
            )
          }
        }
      }
    }

    // Update floating damage numbers
    this.damageNumbers.update(dt)

    // Remove entities that are no longer in the snapshot
    for (const [id, view] of this.entities) {
      if (!activeIds.has(id)) {
        view.renderer.destroy()
        view.healthBar.destroy()
        view.levelBadge?.destroy()
        this.entities.delete(id)
      }
    }
  }

  private createEntity(entity: EntitySnapshot): EntityView {
    if (entity.type === 'tower') {
      return this.createTowerView(entity)
    }
    return this.createChampionView(entity)
  }

  private createChampionView(entity: ChampionSnapshot): EntityView {
    const color = entity.team === 'blue' ? COLORS.CHAMPION_BLUE : COLORS.CHAMPION_RED
    const renderer = new ChampionRenderer3D(color)
    const healthBar = new HealthBar()
    const levelBadge = new LevelBadge()
    // Add health bar and level badge as children of the champion group
    renderer.group.add(healthBar.object)
    renderer.group.add(levelBadge.object)
    this.scene.add(renderer.group)
    return {
      id: entity.id,
      type: 'champion',
      renderer,
      healthBar,
      levelBadge,
      team: entity.team,
      radius: DEFAULT_CHAMPION_RADIUS,
      wasAlive: entity.alive,
      prevHp: entity.hp,
    }
  }

  private createTowerView(entity: TowerSnapshot): EntityView {
    const renderer = new TowerRenderer3D(entity.team, entity.tier, entity.radius)
    const barWidth = entity.tier === 'nexus' ? 160 : 120
    const healthBar = new HealthBar(barWidth, -(entity.radius + 16))
    renderer.group.add(healthBar.object)
    this.scene.add(renderer.group)
    return {
      id: entity.id,
      type: 'tower',
      renderer,
      healthBar,
      levelBadge: null,
      team: entity.team,
      radius: entity.radius,
      wasAlive: entity.alive,
      prevHp: entity.hp,
    }
  }

  /**
   * Hit test: check if world coordinates overlap an enemy entity.
   * Champions are prioritized over towers.
   * Returns the entity ID if found, null otherwise.
   */
  hitTest(worldX: number, worldY: number, localTeam: Team): string | null {
    // First pass: check champions
    for (const entity of this.latestSnapshot) {
      if (entity.type !== 'champion') continue
      if (entity.team === localTeam) continue
      if (!entity.alive) continue

      const dx = worldX - entity.x
      const dy = worldY - entity.y
      const distSq = dx * dx + dy * dy
      if (distSq <= DEFAULT_CHAMPION_RADIUS * DEFAULT_CHAMPION_RADIUS) {
        return entity.id
      }
    }

    // Second pass: check towers
    for (const entity of this.latestSnapshot) {
      if (entity.type !== 'tower') continue
      if (entity.team === localTeam) continue
      if (!entity.alive) continue

      const dx = worldX - entity.x
      const dy = worldY - entity.y
      const distSq = dx * dx + dy * dy
      if (distSq <= entity.radius * entity.radius) {
        return entity.id
      }
    }

    return null
  }

  getEntityTeam(entityId: string): Team | null {
    const entity = this.latestSnapshot.find((e) => e.id === entityId)
    return entity?.team ?? null
  }

  getEntitySnapshot(entityId: string): EntitySnapshot | null {
    return this.latestSnapshot.find((e) => e.id === entityId) ?? null
  }

  /**
   * Get the interpolated position of a specific entity from the latest update.
   * Returns game-world coordinates (x, y).
   */
  getEntityPosition(entityId: string): { x: number; y: number } | null {
    const view = this.entities.get(entityId)
    if (!view) return null
    // Three.js Z → game Y
    return { x: view.renderer.group.position.x, y: view.renderer.group.position.z }
  }

  destroy(): void {
    for (const view of this.entities.values()) {
      view.renderer.destroy()
      view.healthBar.destroy()
      view.levelBadge?.destroy()
    }
    this.entities.clear()
    this.damageNumbers.destroy()
  }
}
