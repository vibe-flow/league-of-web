import type * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { DamageType } from '@template-dev/shared'

const FLOAT_SPEED = 60 // units per second upward
const LIFETIME = 0.8 // seconds
const FADE_START = 0.4 // start fading after this many seconds

const DAMAGE_COLORS_CSS: Record<DamageType, string> = {
  physical: '#ffffff',
  magical: '#6699ff',
  true: '#ff3333',
}

interface FloatingNumber {
  object: CSS2DObject
  age: number
  startY: number
}

export class DamageNumberManager {
  private numbers: FloatingNumber[] = []

  constructor(private readonly scene: THREE.Scene) {}

  spawn(x: number, z: number, amount: number, damageType: DamageType): void {
    const el = document.createElement('span')
    el.textContent = String(Math.round(amount))
    el.style.cssText = `
      font-size: 16px;
      font-family: Arial, sans-serif;
      font-weight: bold;
      color: ${DAMAGE_COLORS_CSS[damageType]};
      text-shadow: 0 0 3px #000, 0 0 3px #000;
      pointer-events: none;
      white-space: nowrap;
    `

    const obj = new CSS2DObject(el)
    // Slight random horizontal offset to avoid overlap
    const startY = 30
    obj.position.set(x + (Math.random() - 0.5) * 30, startY, z)
    this.scene.add(obj)
    this.numbers.push({ object: obj, age: 0, startY })
  }

  update(dt: number): void {
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const num = this.numbers[i]
      num.age += dt
      num.object.position.y = num.startY + FLOAT_SPEED * num.age

      // Fade out
      if (num.age > FADE_START) {
        const fadeProgress = (num.age - FADE_START) / (LIFETIME - FADE_START)
        const alpha = Math.max(0, 1 - fadeProgress)
        num.object.element.style.opacity = String(alpha)
      }

      // Remove when expired
      if (num.age >= LIFETIME) {
        num.object.element.remove()
        this.scene.remove(num.object)
        this.numbers.splice(i, 1)
      }
    }
  }

  destroy(): void {
    for (const num of this.numbers) {
      num.object.element.remove()
      this.scene.remove(num.object)
    }
    this.numbers = []
  }
}
