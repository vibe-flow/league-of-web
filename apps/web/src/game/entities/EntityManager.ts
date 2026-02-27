import type { Container } from 'pixi.js'
import { COLORS, type EntitySnapshot } from '@template-dev/shared'
import { ChampionRenderer } from '../rendering/ChampionRenderer'
import { HealthBar } from '../rendering/HealthBar'

interface EntityView {
  id: string
  renderer: ChampionRenderer
  healthBar: HealthBar
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

  constructor(private readonly gameContainer: Container) {}

  /**
   * Update all entity visuals by interpolating between two snapshots.
   */
  update(fromEntities: EntitySnapshot[], toEntities: EntitySnapshot[], alpha: number): void {
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

      let x: number, y: number, facing: number
      if (fromEntity) {
        x = lerp(fromEntity.x, toEntity.x, alpha)
        y = lerp(fromEntity.y, toEntity.y, alpha)
        facing = lerpAngle(fromEntity.facing, toEntity.facing, alpha)
      } else {
        x = toEntity.x
        y = toEntity.y
        facing = toEntity.facing
      }

      view.renderer.setPosition({ x, y })
      view.renderer.setFacing(facing)
      view.healthBar.update(toEntity.hp / toEntity.maxHp)

      // Toggle visibility based on alive state
      view.renderer.container.visible = toEntity.alive
    }

    // Remove entities that are no longer in the snapshot
    for (const [id, view] of this.entities) {
      if (!activeIds.has(id)) {
        view.renderer.destroy()
        this.entities.delete(id)
      }
    }
  }

  private createEntity(entity: EntitySnapshot): EntityView {
    const color = entity.team === 'blue' ? COLORS.CHAMPION_BLUE : COLORS.CHAMPION_RED
    const renderer = new ChampionRenderer(color)
    const healthBar = new HealthBar()
    renderer.container.addChild(healthBar.container)
    this.gameContainer.addChild(renderer.container)
    return { id: entity.id, renderer, healthBar }
  }

  /**
   * Get the interpolated position of a specific entity from the latest update.
   */
  getEntityPosition(entityId: string): { x: number; y: number } | null {
    const view = this.entities.get(entityId)
    if (!view) return null
    return { x: view.renderer.container.x, y: view.renderer.container.y }
  }

  destroy(): void {
    for (const view of this.entities.values()) {
      view.renderer.destroy()
    }
    this.entities.clear()
  }
}
