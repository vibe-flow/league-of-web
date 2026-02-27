import { INTERPOLATION_DELAY_MS } from '@template-dev/shared'

/**
 * Estimates server game time from snapshot timestamps.
 * Renders INTERPOLATION_DELAY_MS behind to allow smooth interpolation.
 */
export class ClockSync {
  private serverGameTimeMs = 0
  private localTimestampAtSync = 0

  /** Called each time a snapshot arrives */
  onSnapshot(serverGameTimeMs: number): void {
    this.serverGameTimeMs = serverGameTimeMs
    this.localTimestampAtSync = performance.now()
  }

  /** Get the render time (behind server time by interpolation delay) */
  getRenderTimeMs(): number {
    const localElapsed = performance.now() - this.localTimestampAtSync
    return this.serverGameTimeMs + localElapsed - INTERPOLATION_DELAY_MS
  }

  /** Get estimated current server time */
  getServerTimeMs(): number {
    const localElapsed = performance.now() - this.localTimestampAtSync
    return this.serverGameTimeMs + localElapsed
  }
}
