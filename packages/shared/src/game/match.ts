import type { Team } from './types'

// =============================================================================
// Match
// =============================================================================

export type MatchPhase = 'loading' | 'countdown' | 'in_progress' | 'ended'

export interface MatchConfig {
  matchId: string
  players: MatchPlayer[]
}

export interface MatchPlayer {
  playerId: string
  team: Team
  championType: string
}

// =============================================================================
// Lobby
// =============================================================================

export type LobbyStatus = 'waiting' | 'starting' | 'in_progress'

export interface LobbyPlayer {
  userId: string
  team: Team
  ready: boolean
  championType?: string
}

export interface LobbyState {
  id: string
  hostId: string
  players: LobbyPlayer[]
  status: LobbyStatus
  matchId?: string
}
