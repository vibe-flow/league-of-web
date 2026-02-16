import {
  CELL_SIZE,
  CELL_WALKABLE,
  CELL_BUSH,
  type AramMapDefinition,
  type WorldPosition,
  type GridCoord,
} from '@template-dev/shared'

export class NavigationGrid {
  readonly gridWidth: number
  readonly gridHeight: number
  readonly cellSize: number
  private cells: Uint8Array

  constructor(mapDef: AramMapDefinition, cellSize: number = CELL_SIZE) {
    this.cellSize = cellSize
    this.gridWidth = Math.ceil(mapDef.width / cellSize)
    this.gridHeight = Math.ceil(mapDef.height / cellSize)
    this.cells = new Uint8Array(this.gridWidth * this.gridHeight)
    this.generate(mapDef)
  }

  private generate(mapDef: AramMapDefinition): void {
    this.cells.fill(CELL_WALKABLE)

    for (const obs of mapDef.circleObstacles) {
      this.blockCircle(obs.center, obs.radius)
    }
    for (const rect of mapDef.rectObstacles) {
      this.blockRect(rect)
    }
    for (const bush of mapDef.bushZones) {
      this.flagBush(bush)
    }
  }

  private blockCircle(center: { x: number; y: number }, radius: number): void {
    const minGX = Math.max(0, Math.floor((center.x - radius) / this.cellSize))
    const maxGX = Math.min(this.gridWidth - 1, Math.ceil((center.x + radius) / this.cellSize))
    const minGY = Math.max(0, Math.floor((center.y - radius) / this.cellSize))
    const maxGY = Math.min(this.gridHeight - 1, Math.ceil((center.y + radius) / this.cellSize))

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const cx = (gx + 0.5) * this.cellSize
        const cy = (gy + 0.5) * this.cellSize
        const dx = cx - center.x
        const dy = cy - center.y
        if (dx * dx + dy * dy <= radius * radius) {
          this.cells[gy * this.gridWidth + gx] &= ~CELL_WALKABLE
        }
      }
    }
  }

  private blockRect(rect: { x: number; y: number; width: number; height: number }): void {
    const minGX = Math.max(0, Math.floor(rect.x / this.cellSize))
    const maxGX = Math.min(this.gridWidth - 1, Math.ceil((rect.x + rect.width) / this.cellSize))
    const minGY = Math.max(0, Math.floor(rect.y / this.cellSize))
    const maxGY = Math.min(this.gridHeight - 1, Math.ceil((rect.y + rect.height) / this.cellSize))

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        this.cells[gy * this.gridWidth + gx] &= ~CELL_WALKABLE
      }
    }
  }

  private flagBush(rect: { x: number; y: number; width: number; height: number }): void {
    const minGX = Math.max(0, Math.floor(rect.x / this.cellSize))
    const maxGX = Math.min(this.gridWidth - 1, Math.ceil((rect.x + rect.width) / this.cellSize))
    const minGY = Math.max(0, Math.floor(rect.y / this.cellSize))
    const maxGY = Math.min(this.gridHeight - 1, Math.ceil((rect.y + rect.height) / this.cellSize))

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const idx = gy * this.gridWidth + gx
        // Only flag bush on walkable cells
        if (this.cells[idx] & CELL_WALKABLE) {
          this.cells[idx] |= CELL_BUSH
        }
      }
    }
  }

  isWalkable(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return false
    }
    return (this.cells[gy * this.gridWidth + gx] & CELL_WALKABLE) !== 0
  }

  isBush(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return false
    }
    return (this.cells[gy * this.gridWidth + gx] & CELL_BUSH) !== 0
  }

  worldToGrid(pos: WorldPosition): GridCoord {
    return {
      x: Math.floor(pos.x / this.cellSize),
      y: Math.floor(pos.y / this.cellSize),
    }
  }

  gridToWorld(coord: GridCoord): WorldPosition {
    return {
      x: (coord.x + 0.5) * this.cellSize,
      y: (coord.y + 0.5) * this.cellSize,
    }
  }

  getCellFlags(gx: number, gy: number): number {
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return 0
    }
    return this.cells[gy * this.gridWidth + gx]
  }
}
