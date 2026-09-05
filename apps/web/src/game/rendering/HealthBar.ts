import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'

export type BarSide = 'ally' | 'enemy'

const DEFAULT_BAR_WIDTH = 80
const BAR_HEIGHT = 7
const SEGMENT_HP = 100 // one tick mark every 100 HP

export class HealthBar {
  readonly object: CSS2DObject
  private fillEl: HTMLDivElement
  private tickContainer: HTMLDivElement
  private levelEl: HTMLDivElement
  private nameEl: HTMLDivElement
  private side: BarSide
  private lastMaxHp = 0

  constructor(side: BarSide = 'ally', barWidth: number = DEFAULT_BAR_WIDTH) {
    this.side = side

    const borderColor = side === 'ally' ? '#1a78c2' : '#c23030'
    const fillColor = side === 'ally' ? '#2ecc40' : '#e74c3c'

    // Wrapper — centers everything above champion
    const wrapper = document.createElement('div')
    wrapper.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      transform: translateX(-50%);
      pointer-events: none;
    `

    // Champion name
    this.nameEl = document.createElement('div')
    this.nameEl.style.cssText = `
      font-size: 10px;
      font-family: 'Arial Black', Arial, sans-serif;
      font-weight: 800;
      color: #ffffff;
      text-shadow: 0 0 3px rgba(0,0,0,1), 0 1px 2px rgba(0,0,0,0.9);
      margin-bottom: 2px;
      letter-spacing: 0.5px;
      white-space: nowrap;
    `
    wrapper.appendChild(this.nameEl)

    // Bar row — level badge + HP bar
    const barRow = document.createElement('div')
    barRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 0px;
    `

    // Level circle (LoL-style, left of bar)
    this.levelEl = document.createElement('div')
    this.levelEl.style.cssText = `
      width: 16px;
      height: 16px;
      background: #1a1a2e;
      border: 1.5px solid ${borderColor};
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      font-family: Arial, sans-serif;
      font-weight: bold;
      color: #ffffff;
      margin-right: -2px;
      z-index: 1;
      flex-shrink: 0;
    `
    this.levelEl.textContent = '1'
    barRow.appendChild(this.levelEl)

    // Bar container
    const container = document.createElement('div')
    container.style.cssText = `
      width: ${barWidth}px;
      height: ${BAR_HEIGHT}px;
      background: #0a0a0a;
      border: 1.5px solid ${borderColor};
      border-left: none;
      border-radius: 0 3px 3px 0;
      overflow: hidden;
      position: relative;
    `

    // Fill bar
    this.fillEl = document.createElement('div')
    this.fillEl.style.cssText = `
      height: 100%;
      width: 100%;
      background: ${fillColor};
      transition: width 0.08s ease-out;
      position: relative;
    `
    // Subtle highlight on top half for depth
    const shine = document.createElement('div')
    shine.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 50%;
      background: linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 100%);
      pointer-events: none;
    `
    this.fillEl.appendChild(shine)

    container.appendChild(this.fillEl)

    // Tick marks container (for HP segments)
    this.tickContainer = document.createElement('div')
    this.tickContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
    `
    container.appendChild(this.tickContainer)

    barRow.appendChild(container)
    wrapper.appendChild(barRow)

    this.object = new CSS2DObject(wrapper)
    this.object.position.set(0, 280, 0)
  }

  setName(name: string): void {
    this.nameEl.textContent = name
  }

  setLevel(level: number): void {
    this.levelEl.textContent = String(level)
  }

  private buildTicks(maxHp: number): void {
    if (maxHp === this.lastMaxHp) return
    this.lastMaxHp = maxHp

    // Clear old ticks
    this.tickContainer.innerHTML = ''

    const segments = Math.floor(maxHp / SEGMENT_HP)
    for (let i = 1; i < segments; i++) {
      const pct = (i / segments) * 100
      const tick = document.createElement('div')
      tick.style.cssText = `
        position: absolute;
        left: ${pct}%;
        top: 0;
        bottom: 0;
        width: 1px;
        background: rgba(0, 0, 0, 0.4);
      `
      this.tickContainer.appendChild(tick)
    }
  }

  update(ratio: number, _currentHp?: number, maxHp?: number): void {
    const clamped = Math.max(0, Math.min(1, ratio))
    this.fillEl.style.width = `${clamped * 100}%`

    // Side-based coloring with low-HP warning
    if (this.side === 'ally') {
      if (clamped > 0.25) {
        this.fillEl.style.background = '#2ecc40'
      } else {
        this.fillEl.style.background = '#e67e22'
      }
    } else {
      if (clamped > 0.25) {
        this.fillEl.style.background = '#e74c3c'
      } else {
        this.fillEl.style.background = '#c0392b'
      }
    }

    // Update tick marks when maxHp changes
    if (maxHp !== undefined) {
      this.buildTicks(maxHp)
    }
  }

  destroy(): void {
    this.object.element.remove()
    this.object.removeFromParent()
  }
}
