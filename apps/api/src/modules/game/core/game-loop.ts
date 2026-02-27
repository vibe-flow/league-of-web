import { Logger } from '@nestjs/common'
import {
  TICK_RATE,
  TICK_DURATION_MS,
  TICK_DURATION_S,
  MAX_CATCH_UP_TICKS,
} from '@template-dev/shared'
import type { SnapshotPayload } from '@template-dev/shared'
import type { GameState } from './game-state'
import type { InputQueue } from './input-queue'

export class GameLoop {
  private readonly logger: Logger
  private running = false
  private tickNumber = 0
  private gameTimeMs = 0
  private accumulatedLagMs = 0
  private lastTickRealTime = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    matchId: string,
    private readonly state: GameState,
    private readonly inputQueue: InputQueue,
    private readonly onSnapshot: (snapshot: SnapshotPayload) => void,
  ) {
    this.logger = new Logger(`GameLoop:${matchId}`)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTickRealTime = performance.now()
    this.accumulatedLagMs = 0

    // Use setInterval at roughly tick rate; accumulator handles precision
    this.timer = setInterval(() => this.tick(), TICK_DURATION_MS / 2)
    this.logger.log(`Game loop started (${TICK_RATE}Hz)`)
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.logger.log(`Game loop stopped after ${this.tickNumber} ticks`)
  }

  private tick(): void {
    if (!this.running) return

    const now = performance.now()
    const elapsed = now - this.lastTickRealTime
    this.lastTickRealTime = now
    this.accumulatedLagMs += elapsed

    let ticksSimulated = 0

    while (this.accumulatedLagMs >= TICK_DURATION_MS && ticksSimulated < MAX_CATCH_UP_TICKS) {
      const tickStart = performance.now()

      this.executeTick()
      ticksSimulated++

      this.accumulatedLagMs -= TICK_DURATION_MS

      const tickDuration = performance.now() - tickStart
      if (tickDuration > TICK_DURATION_MS) {
        this.logger.warn(`Tick ${this.tickNumber} overran: ${tickDuration.toFixed(1)}ms`)
      }
    }

    // Drop excess lag to prevent spiral of death
    if (this.accumulatedLagMs >= TICK_DURATION_MS) {
      const droppedTicks = Math.floor(this.accumulatedLagMs / TICK_DURATION_MS)
      if (droppedTicks > 0) {
        this.logger.warn(`Dropping ${droppedTicks} ticks to prevent spiral of death`)
      }
      this.accumulatedLagMs %= TICK_DURATION_MS
    }
  }

  private executeTick(): void {
    this.tickNumber++
    this.gameTimeMs += TICK_DURATION_MS

    // 1. Drain input queue
    const inputs = this.inputQueue.drain()

    // 2. Process inputs (validate + apply move commands)
    this.state.processInputs(inputs)

    // 3. Update movement
    this.state.updateMovement(TICK_DURATION_S)

    // 4. Capture snapshot
    const snapshot = this.state.captureSnapshot(this.tickNumber, this.gameTimeMs)

    // 5. Broadcast to clients
    this.onSnapshot(snapshot)
  }

  getTick(): number {
    return this.tickNumber
  }

  getGameTimeMs(): number {
    return this.gameTimeMs
  }
}
