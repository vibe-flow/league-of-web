import { Logger } from '@nestjs/common'
import {
  ARAM_MAP,
  BLUE_SPAWN,
  RED_SPAWN,
  DEFAULT_MOVE_SPEED,
  DEFAULT_HP,
  DEFAULT_MAX_HP,
  WAYPOINT_REACH_THRESHOLD,
  ClientMessageType,
  type MatchConfig,
  type SnapshotPayload,
  type EntitySnapshot,
  type WorldPosition,
  type MoveToPayload,
} from '@template-dev/shared'
import { NavigationGrid, findPath, hasLineOfSight } from '@template-dev/shared'
import type { QueuedInput } from './input-queue'

export interface ChampionEntity {
  id: string
  playerId: string
  team: 'blue' | 'red'
  x: number
  y: number
  facing: number
  hp: number
  maxHp: number
  moveSpeed: number
  alive: boolean
  waypoints: WorldPosition[]
  moveTarget: WorldPosition | null
}

export class GameState {
  private readonly logger = new Logger('GameState')
  private entities = new Map<string, ChampionEntity>()
  private grid: NavigationGrid
  /** Per-player last processed sequence number */
  private lastProcessedSeq = new Map<string, number>()

  constructor(config: MatchConfig) {
    this.grid = new NavigationGrid(ARAM_MAP)

    // Spawn champions
    for (const player of config.players) {
      const spawn = player.team === 'blue' ? BLUE_SPAWN : RED_SPAWN
      const entity: ChampionEntity = {
        id: `champion_${player.playerId}`,
        playerId: player.playerId,
        team: player.team,
        x: spawn.x,
        y: spawn.y,
        facing: player.team === 'blue' ? 0 : Math.PI, // face toward enemy
        hp: DEFAULT_HP,
        maxHp: DEFAULT_MAX_HP,
        moveSpeed: DEFAULT_MOVE_SPEED,
        alive: true,
        waypoints: [],
        moveTarget: null,
      }
      this.entities.set(entity.id, entity)
      this.lastProcessedSeq.set(player.playerId, 0)
    }
  }

  processInputs(inputs: QueuedInput[]): void {
    for (const input of inputs) {
      const entityId = `champion_${input.playerId}`
      const entity = this.entities.get(entityId)
      if (!entity || !entity.alive) continue

      // Track last processed seq
      this.lastProcessedSeq.set(input.playerId, input.sequenceNumber)

      switch (input.type) {
        case ClientMessageType.MOVE_TO: {
          const payload = input.payload as MoveToPayload
          this.handleMoveTo(entity, payload)
          break
        }
        case ClientMessageType.STOP: {
          entity.waypoints = []
          entity.moveTarget = null
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
    }
  }

  updateMovement(dtSeconds: number): void {
    for (const entity of this.entities.values()) {
      if (!entity.alive || entity.waypoints.length === 0) continue

      const target = entity.waypoints[0]
      const dx = target.x - entity.x
      const dy = target.y - entity.y
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist < WAYPOINT_REACH_THRESHOLD) {
        entity.waypoints.shift()
        if (entity.waypoints.length === 0) {
          entity.moveTarget = null
        }
        continue
      }

      // Update facing
      const facingRef = entity.moveTarget ?? target
      const fdx = facingRef.x - entity.x
      const fdy = facingRef.y - entity.y
      entity.facing = Math.atan2(fdy, fdx)

      // Move toward waypoint
      const step = entity.moveSpeed * dtSeconds
      if (step >= dist) {
        entity.x = target.x
        entity.y = target.y
        entity.waypoints.shift()
        if (entity.waypoints.length === 0) {
          entity.moveTarget = null
        }
      } else {
        entity.x += (dx / dist) * step
        entity.y += (dy / dist) * step
      }
    }
  }

  captureSnapshot(tick: number, gameTimeMs: number): SnapshotPayload {
    const entities: EntitySnapshot[] = []
    for (const entity of this.entities.values()) {
      entities.push({
        id: entity.id,
        type: 'champion',
        x: entity.x,
        y: entity.y,
        facing: entity.facing,
        hp: entity.hp,
        maxHp: entity.maxHp,
        team: entity.team,
        alive: entity.alive,
      })
    }

    const lastProcessedSeq: Record<string, number> = {}
    for (const [playerId, seq] of this.lastProcessedSeq) {
      lastProcessedSeq[playerId] = seq
    }

    return { entities, lastProcessedSeq, gameTimeMs }
  }
}
