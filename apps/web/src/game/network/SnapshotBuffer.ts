import type { SnapshotPayload } from '@template-dev/shared'

const MAX_BUFFER_SIZE = 10
/** Maximum extrapolation beyond the last snapshot pair (ms). */
const MAX_EXTRAPOLATION_MS = 100

export interface InterpolationState {
  from: SnapshotPayload
  to: SnapshotPayload
  /** 0..1 = interpolating, >1 = extrapolating (capped). */
  alpha: number
}

export class SnapshotBuffer {
  private snapshots: SnapshotPayload[] = []

  push(snapshot: SnapshotPayload): void {
    this.snapshots.push(snapshot)
    if (this.snapshots.length > MAX_BUFFER_SIZE) {
      this.snapshots.shift()
    }
  }

  /**
   * Find two snapshots that bracket the given render time and compute an
   * interpolation alpha between them.
   *
   * When renderTimeMs is past the newest pair, alpha is allowed to exceed 1.0
   * (up to a cap) so callers can extrapolate positions linearly.
   */
  getInterpolationState(renderTimeMs: number): InterpolationState | null {
    if (this.snapshots.length < 2) return null

    // Purge snapshots that are too old to ever be useful.
    // Keep at least 2 snapshots before renderTimeMs.
    while (this.snapshots.length > 3 && this.snapshots[1].gameTimeMs < renderTimeMs) {
      this.snapshots.shift()
    }

    // Find two snapshots bracketing renderTimeMs
    for (let i = this.snapshots.length - 1; i >= 1; i--) {
      const to = this.snapshots[i]
      const from = this.snapshots[i - 1]
      if (from.gameTimeMs <= renderTimeMs && renderTimeMs <= to.gameTimeMs) {
        const range = to.gameTimeMs - from.gameTimeMs
        const alpha = range > 0 ? (renderTimeMs - from.gameTimeMs) / range : 1
        return { from, to, alpha }
      }
    }

    // Render time is past all snapshots — extrapolate from last pair
    const from = this.snapshots[this.snapshots.length - 2]
    const to = this.snapshots[this.snapshots.length - 1]
    const range = to.gameTimeMs - from.gameTimeMs
    if (range <= 0) return { from, to, alpha: 1 }

    const overshootMs = renderTimeMs - to.gameTimeMs
    const cappedOvershoot = Math.min(overshootMs, MAX_EXTRAPOLATION_MS)
    const alpha = 1 + cappedOvershoot / range
    return { from, to, alpha }
  }

  get length(): number {
    return this.snapshots.length
  }

  getLatest(): SnapshotPayload | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null
  }

  clear(): void {
    this.snapshots = []
  }
}
