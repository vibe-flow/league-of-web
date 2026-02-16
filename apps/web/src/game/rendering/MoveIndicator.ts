import { Graphics } from 'pixi.js'
import { COLORS, type WorldPosition } from '@template-dev/shared'

/** A small animated ring that appears where the player clicks to move. */
export class MoveIndicator {
  readonly graphics = new Graphics()
  private timer = 0
  private active = false
  private static readonly DURATION = 0.6 // seconds
  private static readonly RADIUS = 20

  constructor() {
    this.graphics.label = 'move-indicator'
    this.graphics.visible = false
  }

  show(pos: WorldPosition): void {
    this.graphics.x = pos.x
    this.graphics.y = pos.y
    this.graphics.visible = true
    this.active = true
    this.timer = 0
  }

  update(dt: number): void {
    if (!this.active) return

    this.timer += dt
    const t = this.timer / MoveIndicator.DURATION

    if (t >= 1) {
      this.active = false
      this.graphics.clear()
      this.graphics.visible = false
      return
    }

    // Expanding ring that fades out
    const radius = MoveIndicator.RADIUS * (0.5 + t * 0.5)
    const alpha = 1 - t

    this.graphics.clear()
    this.graphics.circle(0, 0, radius)
    this.graphics.stroke({ width: 2, color: COLORS.MOVE_INDICATOR })
    this.graphics.alpha = alpha
  }

  destroy(): void {
    this.graphics.destroy()
  }
}
