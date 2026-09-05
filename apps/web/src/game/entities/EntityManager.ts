import type * as THREE from 'three'
import {
  COLORS,
  DEFAULT_CHAMPION_RADIUS,
  EntityState,
  getBaseSkinId,
  type EntitySnapshot,
  type ChampionSnapshot,
  type TowerSnapshot,
  type GameEvent,
  type Team,
} from '@template-dev/shared'
import { ChampionRenderer3D } from '../rendering/ChampionRenderer3D'
import { AnimationController } from '../rendering/AnimationController'
import { TowerRenderer3D } from '../rendering/TowerRenderer3D'
import { HealthBar } from '../rendering/HealthBar'
import { DamageNumberManager } from '../rendering/DamageNumber'
import { AssetManager } from '../assets/AssetManager'
import { ASSET_TURRET, ASSET_NEXUS } from '../assets/asset-paths'
import { useGameSettingsStore } from '@/stores/game-settings.store'

/**
 * Smoothing factor for position (per-second exponential lerp).
 * Very high so it converges in ~2-3 frames — just enough to absorb
 * discontinuities when transitioning between snapshot pairs.
 */
const POSITION_SMOOTH = 25
const FACING_SMOOTH = 20

interface EntityView {
  id: string
  type: 'champion' | 'tower'
  renderer: ChampionRenderer3D | TowerRenderer3D
  animController: AnimationController | null
  healthBar: HealthBar
  team: Team
  radius: number
  wasAlive: boolean
  prevHp: number
  /** Smoothed render position (game coords). */
  renderX: number
  renderY: number
  /** Smoothed render facing (radians). */
  renderFacing: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a
  while (diff > Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI
  return a + diff * t
}

export class EntityManager {
  private entities = new Map<string, EntityView>()
  private damageNumbers: DamageNumberManager
  private latestSnapshot: EntitySnapshot[] = []
  localEntityId: string | null = null
  localTeam: Team | null = null

  constructor(private readonly scene: THREE.Scene) {
    this.damageNumbers = new DamageNumberManager(scene)
  }

  update(
    fromEntities: EntitySnapshot[],
    toEntities: EntitySnapshot[],
    alpha: number,
    dt: number,
    events?: GameEvent[],
  ): void {
    this.latestSnapshot = toEntities

    if (!this.localTeam && this.localEntityId) {
      const localEntity = toEntities.find((e) => e.id === this.localEntityId)
      if (localEntity) {
        this.localTeam = localEntity.team
      }
    }

    const activeIds = new Set<string>()

    for (const toEntity of toEntities) {
      activeIds.add(toEntity.id)

      let view = this.entities.get(toEntity.id)
      if (!view) {
        view = this.createEntity(toEntity)
        this.entities.set(toEntity.id, view)
      }

      const fromEntity = fromEntities.find((e) => e.id === toEntity.id)

      // Interpolate (or extrapolate) position from snapshot pair
      let targetX: number, targetY: number
      if (fromEntity) {
        targetX = lerp(fromEntity.x, toEntity.x, alpha)
        targetY = lerp(fromEntity.y, toEntity.y, alpha)
      } else {
        targetX = toEntity.x
        targetY = toEntity.y
      }

      // Light smoothing to absorb discontinuities at snapshot-pair transitions
      const posFactor = Math.min(1, POSITION_SMOOTH * dt)
      view.renderX = lerp(view.renderX, targetX, posFactor)
      view.renderY = lerp(view.renderY, targetY, posFactor)

      view.renderer.setPosition({ x: view.renderX, y: view.renderY })
      view.renderer.updateFlash(dt)
      view.healthBar.update(toEntity.hp / toEntity.maxHp, toEntity.hp, toEntity.maxHp)

      // Champion-specific updates
      if (toEntity.type === 'champion') {
        const fromChamp = fromEntity as ChampionSnapshot | undefined
        const targetFacing = fromChamp
          ? lerpAngle(fromChamp.facing, toEntity.facing, alpha)
          : toEntity.facing

        const faceFactor = Math.min(1, FACING_SMOOTH * dt)
        view.renderFacing = lerpAngle(view.renderFacing, targetFacing, faceFactor)
        view.renderer.setFacing(view.renderFacing)
        view.healthBar.setLevel(toEntity.level)

        // Attack animation
        if (toEntity.state === 'attacking' && toEntity.attackPhase) {
          view.renderer.setAttacking(true, toEntity.attackPhase)
        } else {
          view.renderer.setAttacking(false)
        }

        // Drive animation state from server snapshot
        if (view.animController) {
          const stateMap: Record<string, EntityState> = {
            idle: EntityState.Idle,
            moving: EntityState.Moving,
            attacking: EntityState.Attacking,
            dead: EntityState.Dead,
            respawning: EntityState.Respawning,
          }
          view.animController.setState(stateMap[toEntity.state] ?? EntityState.Idle)
          view.animController.update(dt)
        }
      }

      // --- Combat visual feedback ---
      if (toEntity.alive && !view.wasAlive) {
        view.renderer.setDead(false)
      } else if (!toEntity.alive && view.wasAlive) {
        view.renderer.setDead(true)
      }

      if (toEntity.hp < view.prevHp && toEntity.alive) {
        view.renderer.flashDamage()
      }

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
              targetView.renderer.group.position.z,
              event.amount,
              event.damageType,
            )
          }
        }
      }
    }

    this.damageNumbers.update(dt)

    for (const [id, view] of this.entities) {
      if (!activeIds.has(id)) {
        view.renderer.destroy()
        view.healthBar.destroy()
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
    const isAlly = this.localTeam === entity.team
    const color = isAlly ? COLORS.CHAMPION_BLUE : COLORS.CHAMPION_RED
    const renderer = new ChampionRenderer3D(color)
    const animController = new AnimationController(renderer, entity.championType)
    const side = isAlly ? 'ally' : 'enemy'
    const healthBar = new HealthBar(side)
    healthBar.setName(entity.championType)
    renderer.group.add(healthBar.object)
    this.scene.add(renderer.group)

    this.loadChampionGLB(entity.id, renderer)

    return {
      id: entity.id,
      type: 'champion',
      renderer,
      animController,
      healthBar,
      team: entity.team,
      radius: DEFAULT_CHAMPION_RADIUS,
      wasAlive: entity.alive,
      prevHp: entity.hp,
      renderX: entity.x,
      renderY: entity.y,
      renderFacing: entity.facing,
    }
  }

  private async loadChampionGLB(entityId: string, renderer: ChampionRenderer3D): Promise<void> {
    const { selectedChampion, selectedSkin } = useGameSettingsStore.getState()
    const isLocal = entityId === this.localEntityId
    const alias = isLocal ? selectedChampion : selectedChampion
    const skinId = isLocal ? selectedSkin : (getBaseSkinId(selectedChampion) ?? selectedSkin)

    if (!alias || !skinId) return

    try {
      const manager = AssetManager.getInstance()
      await manager.preloadChampion(alias, skinId)
      if (!this.entities.has(entityId)) return
      const result = manager.getChampionModel(alias, skinId)
      if (result) {
        renderer.setGLBModel(result.model, result.animations)
      }
    } catch (err) {
      console.warn(`[EntityManager] Failed to load GLB for ${entityId}:`, err)
    }
  }

  private createTowerView(entity: TowerSnapshot): EntityView {
    const isAlly = this.localTeam === entity.team
    const displayTeam = isAlly ? 'blue' : 'red'
    const renderer = new TowerRenderer3D(displayTeam, entity.tier, entity.radius)
    const barWidth = entity.tier === 'nexus' ? 160 : 120
    const side = isAlly ? 'ally' : 'enemy'
    const healthBar = new HealthBar(side, barWidth)
    renderer.group.add(healthBar.object)
    this.scene.add(renderer.group)

    this.loadTowerGLB(entity.id, entity.tier, renderer)

    return {
      id: entity.id,
      type: 'tower',
      renderer,
      animController: null,
      healthBar,
      team: entity.team,
      radius: entity.radius,
      wasAlive: entity.alive,
      prevHp: entity.hp,
      renderX: entity.x,
      renderY: entity.y,
      renderFacing: 0,
    }
  }

  private async loadTowerGLB(
    entityId: string,
    tier: string,
    renderer: TowerRenderer3D,
  ): Promise<void> {
    const assetDef = tier === 'nexus' ? ASSET_NEXUS : ASSET_TURRET
    try {
      const manager = AssetManager.getInstance()
      await manager.preloadAsset(assetDef.key, assetDef.path)
      if (!this.entities.has(entityId)) return
      const clone = manager.getAssetClone(assetDef.key)
      if (clone) {
        renderer.setGLBModel(clone.model)
      }
    } catch (err) {
      console.warn(`[EntityManager] Failed to load tower GLB for ${entityId}:`, err)
    }
  }

  hitTest(worldX: number, worldY: number, localTeam: Team): string | null {
    for (const entity of this.latestSnapshot) {
      if (entity.type !== 'champion') continue
      if (entity.team === localTeam) continue
      if (!entity.alive) continue
      const dx = worldX - entity.x
      const dy = worldY - entity.y
      if (dx * dx + dy * dy <= DEFAULT_CHAMPION_RADIUS * DEFAULT_CHAMPION_RADIUS) {
        return entity.id
      }
    }
    for (const entity of this.latestSnapshot) {
      if (entity.type !== 'tower') continue
      if (entity.team === localTeam) continue
      if (!entity.alive) continue
      const dx = worldX - entity.x
      const dy = worldY - entity.y
      if (dx * dx + dy * dy <= entity.radius * entity.radius) {
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

  getEntityPosition(entityId: string): { x: number; y: number } | null {
    const view = this.entities.get(entityId)
    if (!view) return null
    return { x: view.renderer.group.position.x, y: view.renderer.group.position.z }
  }

  setEntityHeight(y: number): void {
    for (const view of this.entities.values()) {
      view.renderer.group.position.y = y
    }
  }

  setStructureScale(scale: number): void {
    for (const view of this.entities.values()) {
      if (view.type === 'tower') {
        ;(view.renderer as TowerRenderer3D).setStructureScale(scale)
      }
    }
  }

  destroy(): void {
    for (const view of this.entities.values()) {
      view.renderer.destroy()
      view.healthBar.destroy()
    }
    this.entities.clear()
    this.damageNumbers.destroy()
  }
}
