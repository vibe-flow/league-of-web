import type { Team } from './types'
import type { MatchPhase } from './match'

// =============================================================================
// Client → Server
// =============================================================================

export enum ClientMessageType {
  MOVE_TO = 0x01,
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

export interface EntitySnapshot {
  id: string
  type: 'champion'
  x: number
  y: number
  facing: number
  hp: number
  maxHp: number
  team: Team
  alive: boolean
}

export interface SnapshotPayload {
  entities: EntitySnapshot[]
  /** Per-player: last processed input sequence number */
  lastProcessedSeq: Record<string, number>
  gameTimeMs: number
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
