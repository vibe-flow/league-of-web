import * as THREE from 'three'
import { MAP_WIDTH, MAP_HEIGHT, ARAM_MAP, COLORS } from '@template-dev/shared'

export class MapRenderer {
  readonly group = new THREE.Group()

  build(): void {
    // Clear any existing children
    while (this.group.children.length > 0) {
      const child = this.group.children[0]
      this.group.remove(child)
    }

    // 1. Lane background — flat plane on XZ
    const laneGeo = new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT)
    const laneMat = new THREE.MeshBasicMaterial({ color: COLORS.LANE })
    const lane = new THREE.Mesh(laneGeo, laneMat)
    lane.rotation.x = -Math.PI / 2
    lane.position.set(MAP_WIDTH / 2, 0, MAP_HEIGHT / 2)
    this.group.add(lane)

    // 2. Ground grid lines
    const GRID_SPACING = 400
    const gridPoints: THREE.Vector3[] = []
    for (let gx = GRID_SPACING; gx < MAP_WIDTH; gx += GRID_SPACING) {
      gridPoints.push(new THREE.Vector3(gx, 0.01, 0))
      gridPoints.push(new THREE.Vector3(gx, 0.01, MAP_HEIGHT))
    }
    for (let gy = GRID_SPACING; gy < MAP_HEIGHT; gy += GRID_SPACING) {
      gridPoints.push(new THREE.Vector3(0, 0.01, gy))
      gridPoints.push(new THREE.Vector3(MAP_WIDTH, 0.01, gy))
    }
    const gridGeo = new THREE.BufferGeometry().setFromPoints(gridPoints)
    const gridMat = new THREE.LineBasicMaterial({
      color: 0x000000,
      opacity: 0.08,
      transparent: true,
    })
    const grid = new THREE.LineSegments(gridGeo, gridMat)
    this.group.add(grid)

    // 3. Base zone indicators
    const blueBaseGeo = new THREE.PlaneGeometry(600, MAP_HEIGHT)
    const blueBaseMat = new THREE.MeshBasicMaterial({
      color: COLORS.BLUE_BASE,
      opacity: 0.12,
      transparent: true,
    })
    const blueBase = new THREE.Mesh(blueBaseGeo, blueBaseMat)
    blueBase.rotation.x = -Math.PI / 2
    blueBase.position.set(300, 0.02, MAP_HEIGHT / 2)
    this.group.add(blueBase)

    const redBaseGeo = new THREE.PlaneGeometry(600, MAP_HEIGHT)
    const redBaseMat = new THREE.MeshBasicMaterial({
      color: COLORS.RED_BASE,
      opacity: 0.12,
      transparent: true,
    })
    const redBase = new THREE.Mesh(redBaseGeo, redBaseMat)
    redBase.rotation.x = -Math.PI / 2
    redBase.position.set(MAP_WIDTH - 300, 0.02, MAP_HEIGHT / 2)
    this.group.add(redBase)

    // 4. Bush zones
    for (const bush of ARAM_MAP.bushZones) {
      const bushGeo = new THREE.PlaneGeometry(bush.width, bush.height)
      const bushMat = new THREE.MeshBasicMaterial({
        color: COLORS.BUSH,
        opacity: 0.45,
        transparent: true,
      })
      const bushMesh = new THREE.Mesh(bushGeo, bushMat)
      bushMesh.rotation.x = -Math.PI / 2
      bushMesh.position.set(bush.x + bush.width / 2, 0.03, bush.y + bush.height / 2)
      this.group.add(bushMesh)
    }

    // 5. Map border (walls)
    const borderPoints = [
      new THREE.Vector3(0, 0.05, 0),
      new THREE.Vector3(MAP_WIDTH, 0.05, 0),
      new THREE.Vector3(MAP_WIDTH, 0.05, MAP_HEIGHT),
      new THREE.Vector3(0, 0.05, MAP_HEIGHT),
      new THREE.Vector3(0, 0.05, 0),
    ]
    const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPoints)
    const borderMat = new THREE.LineBasicMaterial({ color: COLORS.WALL, linewidth: 2 })
    const border = new THREE.Line(borderGeo, borderMat)
    this.group.add(border)
  }

  destroy(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      } else if (obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
      }
    })
    this.group.parent?.remove(this.group)
  }
}
