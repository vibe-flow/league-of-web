import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { DEFAULT_CHAMPION_RADIUS } from '@template-dev/shared'

const BADGE_SIZE = 20

export class LevelBadge {
  readonly object: CSS2DObject
  private textEl: HTMLSpanElement
  private currentLevel = 0

  constructor() {
    const container = document.createElement('div')
    container.style.cssText = `
      width: ${BADGE_SIZE}px;
      height: ${BADGE_SIZE}px;
      background: #222222;
      border: 1.5px solid #ccaa00;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translateX(-50%);
      pointer-events: none;
    `

    this.textEl = document.createElement('span')
    this.textEl.textContent = '1'
    this.textEl.style.cssText = `
      font-size: 11px;
      font-family: Arial, sans-serif;
      font-weight: bold;
      color: #ffffff;
      line-height: 1;
    `
    container.appendChild(this.textEl)

    this.object = new CSS2DObject(container)
    // Position below the entity
    this.object.position.set(0, -5, DEFAULT_CHAMPION_RADIUS + 12)
  }

  setLevel(level: number): void {
    if (level === this.currentLevel) return
    this.currentLevel = level
    this.textEl.textContent = String(level)
  }

  destroy(): void {
    this.object.element.remove()
    this.object.removeFromParent()
  }
}
