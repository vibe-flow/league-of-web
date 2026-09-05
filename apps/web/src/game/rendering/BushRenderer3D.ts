import * as THREE from 'three'

interface BushZone {
  x: number
  y: number
  width: number
  height: number
}

export class BushRenderer3D {
  readonly group = new THREE.Group()

  constructor(bush: BushZone) {
    const cx = bush.x + bush.width / 2
    const cz = bush.y + bush.height / 2

    // Ground plane (semi-transparent green, slightly above terrain)
    const groundGeo = new THREE.PlaneGeometry(bush.width, bush.height)
    const groundMat = new THREE.MeshLambertMaterial({
      color: 0x1a5c28,
      transparent: true,
      opacity: 0.5,
    })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    ground.position.set(cx, 0.5, cz)
    this.group.add(ground)

    // Scatter foliage tufts across the zone
    const area = bush.width * bush.height
    const tuftCount = Math.max(4, Math.floor(area / 2500))

    for (let i = 0; i < tuftCount; i++) {
      const tuft = this.createTuft()
      tuft.position.set(
        bush.x + Math.random() * bush.width,
        0,
        bush.y + Math.random() * bush.height,
      )
      this.group.add(tuft)
    }
  }

  private createTuft(): THREE.Group {
    const tuft = new THREE.Group()

    // Low-poly icosahedron for foliage volume
    const radius = 12 + Math.random() * 10
    const geo = new THREE.IcosahedronGeometry(radius, 1)
    const hue = 0.3 + Math.random() * 0.08 // green range
    const sat = 0.55 + Math.random() * 0.25
    const light = 0.22 + Math.random() * 0.12
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color().setHSL(hue, sat, light),
      transparent: true,
      opacity: 0.75,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.y = 6 + Math.random() * 8
    mesh.scale.set(1, 0.55, 1) // squash for bush feel
    mesh.rotation.y = Math.random() * Math.PI * 2
    tuft.add(mesh)

    return tuft
  }

  destroy(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
    })
    this.group.parent?.remove(this.group)
  }
}
