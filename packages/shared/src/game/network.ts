import type { Team } from './types'
import type { MatchPhase } from './match'
import type { EntityState, AttackPhase, DamageType } from './combat'
import type { TowerTier } from './constants'

// =============================================================================
// Client → Server
// =============================================================================

export enum ClientMessageType {
  MOVE_TO = 0x01,
  ATTACK_TARGET = 0x02,
  STOP = 0x04,
  PING_REQUEST = 0x08,
}

export interface ClientMessage {
  type: ClientMessageType
  seq: number
  tick: number
  payload: unknown
}

export interface MoveToPayload {
  x: number
  y: number
}

export interface AttackTargetPayload {
  targetEntityId: string
}

export interface StopPayload {}

export interface PingRequestPayload {
  clientTime: number
}

// =============================================================================
// Server → Client
// =============================================================================

export enum ServerMessageType {
  SNAPSHOT = 0x10,
  PING_RESPONSE = 0x16,
  MATCH_PHASE = 0x18,
}

export interface ServerMessage {
  type: ServerMessageType
  tick: number
  timestamp: number // ms since match start
  payload: unknown
}

export interface ChampionSnapshot {
  id: string
  type: 'champion'
  x: number
  y: number
  facing: number
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  team: Team
  alive: boolean
  // Champion identity
  championType: string
  // Combat state
  state: EntityState
  attackPhase?: AttackPhase
  attackTargetId?: string
  // Stats (for client HUD)
  level: number
  xp: number
  xpToNextLevel: number
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
  // Death
  respawnTimerMs?: number
}

export interface TowerSnapshot {
  id: string
  type: 'tower'
  x: number
  y: number
  hp: number
  maxHp: number
  team: Team
  alive: boolean
  tier: TowerTier | 'nexus'
  radius: number
  armor: number
  magicResist: number
  orderIndex: number
}

export type EntitySnapshot = ChampionSnapshot | TowerSnapshot

// =============================================================================
// Game Events (piggybacked on snapshots)
// =============================================================================

export interface DamageEvent {
  type: 'damage'
  sourceId: string
  targetId: string
  amount: number
  damageType: DamageType
  killed: boolean
}

export interface LevelUpEvent {
  type: 'levelUp'
  entityId: string
  newLevel: number
}

export interface RespawnEvent {
  type: 'respawn'
  entityId: string
  x: number
  y: number
}

export interface TowerDestroyedEvent {
  type: 'towerDestroyed'
  entityId: string
  team: Team
  tier: TowerTier | 'nexus'
}

export type GameEvent = DamageEvent | LevelUpEvent | RespawnEvent | TowerDestroyedEvent

// =============================================================================
// Snapshots
// =============================================================================

export interface SnapshotPayload {
  entities: EntitySnapshot[]
  /** Per-player: last processed input sequence number */
  lastProcessedSeq: Record<string, number>
  gameTimeMs: number
  /** Combat events that occurred during this tick */
  events: GameEvent[]
}

export interface PingResponsePayload {
  clientTime: number
  serverTime: number
}

export interface MatchPhasePayload {
  phase: MatchPhase
  countdownMs?: number
}

// =============================================================================
// WebSocket Envelope (used for native WS message framing)
// =============================================================================

export interface WsEnvelope {
  event: string
  data: unknown
}
