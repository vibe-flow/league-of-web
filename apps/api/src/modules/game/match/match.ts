import { Logger } from '@nestjs/common'
import type { MatchConfig, ClientMessage, SnapshotPayload, MatchPhase } from '@template-dev/shared'
import { ClientMessageType } from '@template-dev/shared'
import { GameState } from '../core/game-state'
import { GameLoop } from '../core/game-loop'
import { InputQueue } from '../core/input-queue'

export class Match {
  private readonly logger = new Logger(`Match:${this.config.matchId}`)
  private readonly state: GameState
  private readonly loop: GameLoop
  private readonly inputQueue: InputQueue
  private phase: MatchPhase = 'loading'

  private connectedPlayers = new Set<string>()

  /** Called when all players have disconnected from a running match. */
  onEmpty: (() => void) | null = null

  constructor(
    private readonly config: MatchConfig,
    private readonly broadcast: (event: string, data: unknown) => void,
  ) {
    this.inputQueue = new InputQueue()
    this.state = new GameState(config)
    this.loop = new GameLoop(config.matchId, this.state, this.inputQueue, (snapshot) =>
      this.onSnapshot(snapshot),
    )
  }

  start(): void {
    this.phase = 'in_progress'
    this.loop.start()
    this.broadcast('matchPhase', { phase: this.phase })
    this.logger.log('Match started')
  }

  stop(): void {
    this.phase = 'ended'
    this.loop.stop()
    this.broadcast('matchPhase', { phase: this.phase })
    this.logger.log('Match stopped')
  }

  addClient(playerId: string): void {
    this.connectedPlayers.add(playerId)
    this.logger.log(`Player ${playerId} joined`)
  }

  removeClient(playerId: string): void {
    this.connectedPlayers.delete(playerId)
    this.logger.log(`Player ${playerId} left`)

    if (this.connectedPlayers.size === 0 && this.phase === 'in_progress') {
      this.logger.log('All players disconnected')
      this.onEmpty?.()
    }
  }

  get connectedPlayerCount(): number {
    return this.connectedPlayers.size
  }

  handleInput(playerId: string, msg: ClientMessage): void {
    if (this.phase !== 'in_progress') return

    switch (msg.type) {
      case ClientMessageType.MOVE_TO:
      case ClientMessageType.STOP:
      case ClientMessageType.ATTACK_TARGET:
        this.inputQueue.enqueue({
          playerId,
          type: msg.type,
          payload: msg.payload,
          receivedAt: performance.now(),
          clientTick: msg.tick,
          sequenceNumber: msg.seq,
        })
        break
      default:
        this.logger.warn(`Unknown input type: ${msg.type}`)
    }
  }

  private onSnapshot(snapshot: SnapshotPayload): void {
    this.broadcast('snapshot', snapshot)
  }

  getPhase(): MatchPhase {
    return this.phase
  }

  getConfig(): MatchConfig {
    return this.config
  }
}
