import { INTERPOLATION_DELAY_MS } from '@template-dev/shared'

/**
 * Estimates server game time from snapshot timestamps.
 * Renders INTERPOLATION_DELAY_MS behind to allow smooth interpolation.
 *
 * Uses an EMA (Exponential Moving Average) to smooth the server-to-client
 * clock offset. This prevents micro-jumps in render time caused by network
 * jitter — when snapshots arrive a few ms early or late, the raw "snap"
 * approach causes the render time to advance irregularly, producing visible
 * stuttering in interpolated positions.
 */
export class ClockSync {
  /** Smoothed offset = serverGameTimeMs - performance.now() */
  private offset = 0
  private initialized = false

  /** EMA smoothing factor (0..1). Lower = smoother but slower to adapt. */
  private static readonly EMA_ALPHA = 0.1

  /** Called each time a snapshot arrives */
  onSnapshot(serverGameTimeMs: number): void {
    const now = performance.now()
    const sampleOffset = serverGameTimeMs - now

    if (!this.initialized) {
      this.offset = sampleOffset
      this.initialized = true
    } else {
      // Exponential moving average of the offset
      this.offset += ClockSync.EMA_ALPHA * (sampleOffset - this.offset)
    }
  }

  /** Get the render time (behind server time by interpolation delay) */
  getRenderTimeMs(): number {
    // estimatedServerTime = performance.now() + smoothedOffset
    return performance.now() + this.offset - INTERPOLATION_DELAY_MS
  }

  /** Get estimated current server time */
  getServerTimeMs(): number {
    return performance.now() + this.offset
  }
}
