import { Container, Graphics } from 'pixi.js'
import { MAP_WIDTH, MAP_HEIGHT, NEXUS_RADIUS, ARAM_MAP, COLORS } from '@template-dev/shared'

export class MapRenderer {
  readonly container = new Container()

  constructor() {
    this.container.label = 'map'
  }

  build(): void {
    this.container.removeChildren()

    // Draw the entire static map in a single Graphics to avoid PixiJS v8
    // rendering artifacts with multiple Graphics + alpha
    const g = new Graphics()

    // 1. Lane background
    g.rect(0, 0, MAP_WIDTH, MAP_HEIGHT)
    g.fill(COLORS.LANE)

    // 2. Ground grid lines
    const GRID_SPACING = 400
    for (let gx = GRID_SPACING; gx < MAP_WIDTH; gx += GRID_SPACING) {
      g.moveTo(gx, 0)
      g.lineTo(gx, MAP_HEIGHT)
    }
    for (let gy = GRID_SPACING; gy < MAP_HEIGHT; gy += GRID_SPACING) {
      g.moveTo(0, gy)
      g.lineTo(MAP_WIDTH, gy)
    }
    g.stroke({ width: 1, color: 0x000000, alpha: 0.08 })

    // 3. Base zone indicators
    g.rect(0, 0, 600, MAP_HEIGHT)
    g.fill({ color: COLORS.BLUE_BASE, alpha: 0.12 })

    g.rect(MAP_WIDTH - 600, 0, 600, MAP_HEIGHT)
    g.fill({ color: COLORS.RED_BASE, alpha: 0.12 })

    // 4. Bush zones
    for (const bush of ARAM_MAP.bushZones) {
      g.rect(bush.x, bush.y, bush.width, bush.height)
      g.fill({ color: COLORS.BUSH, alpha: 0.45 })
    }

    // 5. Structures — Nexus & Turrets
    for (const obs of ARAM_MAP.circleObstacles) {
      const isBlue = obs.center.x < MAP_WIDTH / 2
      const isNexus = obs.radius >= NEXUS_RADIUS

      g.circle(obs.center.x, obs.center.y, obs.radius)
      if (isNexus) {
        g.fill(isBlue ? COLORS.NEXUS_BLUE : COLORS.NEXUS_RED)
      } else {
        g.fill(isBlue ? COLORS.TURRET_BLUE : COLORS.TURRET_RED)
      }
      // Border
      g.circle(obs.center.x, obs.center.y, obs.radius)
      g.stroke({ width: 2, color: 0x000000, alpha: 0.6 })
    }

    // 6. Map border (walls)
    g.rect(0, 0, MAP_WIDTH, MAP_HEIGHT)
    g.stroke({ width: 4, color: COLORS.WALL })

    this.container.addChild(g)
  }

  destroy(): void {
    this.container.destroy({ children: true })
  }
}
