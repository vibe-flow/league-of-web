import { Injectable, Inject, Logger, forwardRef } from '@nestjs/common'
import { TRPCError } from '@trpc/server'
import {
  MAX_PLAYERS_PHASE2,
  type LobbyState,
  type LobbyPlayer,
  type Team,
  type MatchConfig,
} from '@template-dev/shared'
import { MatchManagerService } from '../match/match-manager.service'

@Injectable()
export class LobbyService {
  private readonly logger = new Logger(LobbyService.name)
  private lobbies = new Map<string, LobbyState>()

  constructor(
    @Inject(forwardRef(() => MatchManagerService))
    private readonly matchManager: MatchManagerService,
  ) {}

  createLobby(hostId: string): LobbyState {
    const lobbyId = `lobby_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const lobby: LobbyState = {
      id: lobbyId,
      hostId,
      players: [{ userId: hostId, team: 'blue', ready: false }],
      status: 'waiting',
    }
    this.lobbies.set(lobbyId, lobby)
    this.logger.log(`Lobby ${lobbyId} created by ${hostId}`)
    return lobby
  }

  joinLobby(lobbyId: string, userId: string): LobbyState {
    const lobby = this.getLobbyOrThrow(lobbyId)

    if (lobby.status !== 'waiting') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Lobby is not accepting players' })
    }

    if (lobby.players.some((p) => p.userId === userId)) {
      // Already in lobby — return current state
      return lobby
    }

    if (lobby.players.length >= MAX_PLAYERS_PHASE2) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Lobby is full' })
    }

    // Auto-assign to the team with fewer players
    const blueCount = lobby.players.filter((p) => p.team === 'blue').length
    const redCount = lobby.players.filter((p) => p.team === 'red').length
    const team: Team = blueCount <= redCount ? 'blue' : 'red'

    lobby.players.push({ userId, team, ready: false })
    this.logger.log(`Player ${userId} joined lobby ${lobbyId} as ${team}`)
    return lobby
  }

  setTeam(lobbyId: string, userId: string, team: Team): LobbyState {
    const lobby = this.getLobbyOrThrow(lobbyId)
    const player = this.getPlayerOrThrow(lobby, userId)
    player.team = team
    // Reset ready when changing team
    player.ready = false
    return lobby
  }

  setReady(lobbyId: string, userId: string, ready: boolean): LobbyState {
    const lobby = this.getLobbyOrThrow(lobbyId)
    const player = this.getPlayerOrThrow(lobby, userId)
    player.ready = ready
    return lobby
  }

  startMatch(lobbyId: string, userId: string): { lobby: LobbyState; matchId: string } {
    const lobby = this.getLobbyOrThrow(lobbyId)

    if (lobby.hostId !== userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the host can start the match' })
    }

    if (lobby.players.length < 2) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Need at least 2 players to start' })
    }

    if (!lobby.players.every((p) => p.ready)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not all players are ready' })
    }

    const matchId = `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const config: MatchConfig = {
      matchId,
      players: lobby.players.map((p) => ({
        playerId: p.userId,
        team: p.team,
        championType: p.championType ?? 'default',
      })),
    }

    this.matchManager.createMatch(config)

    lobby.status = 'in_progress'
    lobby.matchId = matchId

    this.logger.log(`Match ${matchId} started from lobby ${lobbyId}`)
    return { lobby, matchId }
  }

  getLobby(lobbyId: string): LobbyState | null {
    return this.lobbies.get(lobbyId) ?? null
  }

  listLobbies(): LobbyState[] {
    return Array.from(this.lobbies.values()).filter((l) => l.status === 'waiting')
  }

  private getLobbyOrThrow(lobbyId: string): LobbyState {
    const lobby = this.lobbies.get(lobbyId)
    if (!lobby) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Lobby not found' })
    }
    return lobby
  }

  private getPlayerOrThrow(lobby: LobbyState, userId: string): LobbyPlayer {
    const player = lobby.players.find((p) => p.userId === userId)
    if (!player) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Player not in this lobby' })
    }
    return player
  }
}
