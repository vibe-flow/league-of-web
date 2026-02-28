import type { SnapshotPayload } from '@template-dev/shared'

const MAX_BUFFER_SIZE = 5

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
   */
  getInterpolationState(renderTimeMs: number): {
    from: SnapshotPayload
    to: SnapshotPayload
    alpha: number
  } | null {
    if (this.snapshots.length < 2) return null

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

    // If render time is past all snapshots, use last two and clamp alpha
    const from = this.snapshots[this.snapshots.length - 2]
    const to = this.snapshots[this.snapshots.length - 1]
    const range = to.gameTimeMs - from.gameTimeMs
    const alpha = range > 0 ? (renderTimeMs - from.gameTimeMs) / range : 1
    return { from, to, alpha: Math.min(alpha, 1) }
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
