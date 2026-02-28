import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { DEFAULT_CHAMPION_RADIUS } from '@template-dev/shared'

const DEFAULT_BAR_WIDTH = 80
const BAR_HEIGHT = 8

export class HealthBar {
  readonly object: CSS2DObject
  private fillEl: HTMLDivElement
  constructor(barWidth: number = DEFAULT_BAR_WIDTH, offsetY?: number) {
    const _offsetY = offsetY ?? -(DEFAULT_CHAMPION_RADIUS + 16)

    // Container div
    const container = document.createElement('div')
    container.style.cssText = `
      width: ${barWidth}px;
      height: ${BAR_HEIGHT}px;
      background: #333333;
      border: 1px solid #000000;
      border-radius: 2px;
      overflow: hidden;
      transform: translateX(-50%);
      pointer-events: none;
    `

    // Fill bar
    this.fillEl = document.createElement('div')
    this.fillEl.style.cssText = `
      height: 100%;
      width: 100%;
      background: #22cc44;
      border-radius: 1px;
      transition: width 0.05s linear;
    `
    container.appendChild(this.fillEl)

    this.object = new CSS2DObject(container)
    // Position above the entity in 3D space (Y up in Three.js)
    // Use a fixed height above entities; negative offsetY maps to positive Y
    this.object.position.set(0, Math.abs(_offsetY) + 20, 0)
  }

  update(ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio))
    this.fillEl.style.width = `${clamped * 100}%`

    // Dynamic color based on HP ratio
    if (clamped > 0.5) {
      this.fillEl.style.background = '#22cc44' // green
    } else if (clamped > 0.25) {
      this.fillEl.style.background = '#ddaa00' // yellow
    } else {
      this.fillEl.style.background = '#cc2222' // red
    }
  }

  destroy(): void {
    this.object.element.remove()
    this.object.removeFromParent()
  }
}
