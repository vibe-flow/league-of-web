import { Container, Graphics } from 'pixi.js'
import { DEFAULT_CHAMPION_RADIUS, COLORS } from '@template-dev/shared'

const BAR_WIDTH = 80
const BAR_HEIGHT = 8
const BAR_OFFSET_Y = -(DEFAULT_CHAMPION_RADIUS + 16)

export class HealthBar {
  readonly container = new Container()
  private bg: Graphics
  private fill: Graphics

  constructor() {
    this.container.label = 'healthbar'

    // Background
    this.bg = new Graphics()
    this.bg.roundRect(-BAR_WIDTH / 2, BAR_OFFSET_Y, BAR_WIDTH, BAR_HEIGHT, 2)
    this.bg.fill(COLORS.HEALTH_BAR_BG)
    this.bg.roundRect(-BAR_WIDTH / 2, BAR_OFFSET_Y, BAR_WIDTH, BAR_HEIGHT, 2)
    this.bg.stroke({ width: 1, color: COLORS.HEALTH_BAR_BORDER })
    this.container.addChild(this.bg)

    // Fill
    this.fill = new Graphics()
    this.container.addChild(this.fill)

    this.update(1)
  }

  update(ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio))
    const fillWidth = BAR_WIDTH * clamped

    this.fill.clear()
    if (fillWidth > 2) {
      this.fill.roundRect(-BAR_WIDTH / 2 + 1, BAR_OFFSET_Y + 1, fillWidth - 2, BAR_HEIGHT - 2, 1)
      this.fill.fill(COLORS.HEALTH_BAR_FILL)
    }
  }

  setPosition(x: number, y: number): void {
    this.container.x = x
    this.container.y = y
  }

  destroy(): void {
    this.container.destroy({ children: true })
  }
}
