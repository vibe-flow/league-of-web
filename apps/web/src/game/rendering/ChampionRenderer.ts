import { Container, Graphics } from 'pixi.js'
import { DEFAULT_CHAMPION_RADIUS, COLORS, type WorldPosition } from '@template-dev/shared'

export class ChampionRenderer {
  readonly container = new Container()
  private body: Graphics
  private arrow: Graphics
  private _facing = 0 // angle in radians

  constructor(private color: number = COLORS.CHAMPION_BLUE) {
    this.container.label = 'champion'

    // Circle body
    this.body = new Graphics()
    this.body.circle(0, 0, DEFAULT_CHAMPION_RADIUS)
    this.body.fill(this.color)
    this.body.circle(0, 0, DEFAULT_CHAMPION_RADIUS)
    this.body.stroke({ width: 3, color: 0x000000 })
    this.container.addChild(this.body)

    // Direction arrow
    this.arrow = new Graphics()
    this.drawArrow()
    this.container.addChild(this.arrow)
  }

  private drawArrow(): void {
    this.arrow.clear()
    const r = DEFAULT_CHAMPION_RADIUS
    // Arrow pointing right (will be rotated via container)
    this.arrow.moveTo(r * 0.3, 0)
    this.arrow.lineTo(r * 1.1, 0)
    this.arrow.moveTo(r * 0.85, -r * 0.25)
    this.arrow.lineTo(r * 1.1, 0)
    this.arrow.lineTo(r * 0.85, r * 0.25)
    this.arrow.stroke({ width: 3, color: 0xffffff })
  }

  setPosition(pos: WorldPosition): void {
    this.container.x = pos.x
    this.container.y = pos.y
  }

  setFacing(angle: number): void {
    this._facing = angle
    this.arrow.rotation = angle
  }

  get facing(): number {
    return this._facing
  }

  destroy(): void {
    this.container.destroy({ children: true })
  }
}
