import {
  Injectable,
  Inject,
  Logger,
  forwardRef,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common'
import type { MatchConfig } from '@template-dev/shared'
import { Match } from './match'
import { GameWebSocketServer } from '../game.gateway'

/** Max match duration before forced cleanup (30 minutes). */
const MAX_MATCH_DURATION_MS = 30 * 60 * 1000
/** Grace period after all players disconnect before destroying (30 seconds). */
const EMPTY_MATCH_GRACE_MS = 30 * 1000

@Injectable()
export class MatchManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchManagerService.name)
  private matches = new Map<string, Match>()
  private matchTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    @Inject(forwardRef(() => GameWebSocketServer))
    private readonly wsServer: GameWebSocketServer,
  ) {}

  onModuleInit(): void {
    this.wsServer.setMatchManager(this)
  }

  createMatch(config: MatchConfig): Match {
    if (this.matches.has(config.matchId)) {
      throw new Error(`Match ${config.matchId} already exists`)
    }

    const match = new Match(config, (event, data) => {
      this.wsServer.broadcastToMatch(config.matchId, event, data)
    })

    // Auto-destroy when all players leave (with grace period for reconnection)
    match.onEmpty = () => {
      this.logger.log(
        `Match ${config.matchId} is empty, starting ${EMPTY_MATCH_GRACE_MS}ms grace period`,
      )
      const timer = setTimeout(() => {
        const m = this.matches.get(config.matchId)
        if (m && m.connectedPlayerCount === 0) {
          this.destroyMatch(config.matchId)
        }
      }, EMPTY_MATCH_GRACE_MS)
      this.matchTimers.set(`empty_${config.matchId}`, timer)
    }

    this.matches.set(config.matchId, match)
    this.logger.log(`Match ${config.matchId} created with ${config.players.length} players`)

    // Safety timeout — force-destroy after max duration
    const maxTimer = setTimeout(() => {
      if (this.matches.has(config.matchId)) {
        this.logger.warn(`Match ${config.matchId} hit max duration, force-destroying`)
        this.destroyMatch(config.matchId)
      }
    }, MAX_MATCH_DURATION_MS)
    this.matchTimers.set(`max_${config.matchId}`, maxTimer)

    match.start()
    return match
  }

  getMatch(matchId: string): Match | null {
    return this.matches.get(matchId) ?? null
  }

  destroyMatch(matchId: string): void {
    const match = this.matches.get(matchId)
    if (match) {
      match.stop()
      this.matches.delete(matchId)
      this.clearMatchTimers(matchId)
      this.wsServer.cleanupMatchRoom(matchId)
      this.logger.log(`Match ${matchId} destroyed`)
    }
  }

  getActiveMatchCount(): number {
    return this.matches.size
  }

  /** Clear all timers associated with a match. */
  private clearMatchTimers(matchId: string): void {
    for (const key of [`empty_${matchId}`, `max_${matchId}`]) {
      const timer = this.matchTimers.get(key)
      if (timer) {
        clearTimeout(timer)
        this.matchTimers.delete(key)
      }
    }
  }

  /** Cleanup all matches on module destroy (server shutdown). */
  onModuleDestroy(): void {
    for (const [matchId] of this.matches) {
      this.destroyMatch(matchId)
    }
  }
}
