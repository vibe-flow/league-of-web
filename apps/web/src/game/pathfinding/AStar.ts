import { MAX_ASTAR_ITERATIONS, type WorldPosition, type GridCoord } from '@template-dev/shared'
import type { NavigationGrid } from './NavigationGrid'

// =============================================================================
// Direction offsets
// =============================================================================

const DIRECTIONS = [
  { dx: 0, dy: -1, cost: 1.0 }, // N
  { dx: 1, dy: 0, cost: 1.0 }, // E
  { dx: 0, dy: 1, cost: 1.0 }, // S
  { dx: -1, dy: 0, cost: 1.0 }, // W
  { dx: 1, dy: -1, cost: Math.SQRT2 }, // NE
  { dx: 1, dy: 1, cost: Math.SQRT2 }, // SE
  { dx: -1, dy: 1, cost: Math.SQRT2 }, // SW
  { dx: -1, dy: -1, cost: Math.SQRT2 }, // NW
]

// =============================================================================
// MinHeap
// =============================================================================

class MinHeap<T> {
  private data: { key: number; value: T }[] = []

  get size(): number {
    return this.data.length
  }

  push(key: number, value: T): void {
    this.data.push({ key, value })
    this.bubbleUp(this.data.length - 1)
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined
    const top = this.data[0].value
    const last = this.data.pop()!
    if (this.data.length > 0) {
      this.data[0] = last
      this.sinkDown(0)
    }
    return top
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.data[i].key >= this.data[parent].key) break
      ;[this.data[i], this.data[parent]] = [this.data[parent], this.data[i]]
      i = parent
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length
    while (true) {
      let smallest = i
      const left = 2 * i + 1
      const right = 2 * i + 2
      if (left < n && this.data[left].key < this.data[smallest].key) smallest = left
      if (right < n && this.data[right].key < this.data[smallest].key) smallest = right
      if (smallest === i) break
      ;[this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]]
      i = smallest
    }
  }
}

// =============================================================================
// Heuristic
// =============================================================================

function heuristic(a: GridCoord, b: GridCoord): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

// =============================================================================
// Find nearest walkable cell (BFS)
// =============================================================================

function findNearestWalkable(grid: NavigationGrid, target: GridCoord): GridCoord | null {
  const visited = new Set<number>()
  const queue: GridCoord[] = [target]
  let head = 0
  const toIndex = (x: number, y: number) => y * grid.gridWidth + x

  visited.add(toIndex(target.x, target.y))

  while (head < queue.length) {
    const current = queue[head++]
    if (grid.isWalkable(current.x, current.y)) {
      return current
    }
    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.dx
      const ny = current.y + dir.dy
      const idx = toIndex(nx, ny)
      if (nx >= 0 && nx < grid.gridWidth && ny >= 0 && ny < grid.gridHeight && !visited.has(idx)) {
        visited.add(idx)
        queue.push({ x: nx, y: ny })
      }
    }
  }
  return null
}

// =============================================================================
// Line-of-sight check (Bresenham)
// =============================================================================

export function hasLineOfSight(grid: NavigationGrid, from: GridCoord, to: GridCoord): boolean {
  let x0 = from.x
  let y0 = from.y
  const x1 = to.x
  const y1 = to.y

  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1

  let err = dx - dy

  while (true) {
    if (!grid.isWalkable(x0, y0)) return false
    if (x0 === x1 && y0 === y1) break

    const e2 = 2 * err
    if (e2 > -dy && e2 < dx) {
      if (!grid.isWalkable(x0 + sx, y0) || !grid.isWalkable(x0, y0 + sy)) {
        return false
      }
    }
    if (e2 > -dy) {
      err -= dy
      x0 += sx
    }
    if (e2 < dx) {
      err += dx
      y0 += sy
    }
  }
  return true
}

// =============================================================================
// Path smoothing
// =============================================================================

function smoothPath(path: WorldPosition[], grid: NavigationGrid): WorldPosition[] {
  if (path.length <= 2) return path

  const smoothed: WorldPosition[] = [path[0]]
  let anchor = 0

  while (anchor < path.length - 1) {
    let farthestVisible = anchor + 1

    for (let i = anchor + 2; i < path.length; i++) {
      const fromGrid = grid.worldToGrid(path[anchor])
      const toGrid = grid.worldToGrid(path[i])
      if (hasLineOfSight(grid, fromGrid, toGrid)) {
        farthestVisible = i
      } else {
        break
      }
    }

    smoothed.push(path[farthestVisible])
    anchor = farthestVisible
  }

  return smoothed
}

// =============================================================================
// A* path reconstruction
// =============================================================================

interface PathNode {
  x: number
  y: number
  g: number
  f: number
  parent: PathNode | null
}

function reconstructPath(goalNode: PathNode, grid: NavigationGrid): WorldPosition[] {
  const path: WorldPosition[] = []
  let node: PathNode | null = goalNode
  while (node !== null) {
    path.push(grid.gridToWorld({ x: node.x, y: node.y }))
    node = node.parent
  }
  path.reverse()
  return path
}

// =============================================================================
// A* find path
// =============================================================================

export function findPath(
  grid: NavigationGrid,
  start: WorldPosition,
  goal: WorldPosition,
  maxIter: number = MAX_ASTAR_ITERATIONS,
): WorldPosition[] | null {
  const startGrid = { ...grid.worldToGrid(start) }
  const goalGrid = { ...grid.worldToGrid(goal) }

  if (!grid.isWalkable(startGrid.x, startGrid.y)) {
    const nearest = findNearestWalkable(grid, startGrid)
    if (!nearest) return null
    startGrid.x = nearest.x
    startGrid.y = nearest.y
  }

  if (!grid.isWalkable(goalGrid.x, goalGrid.y)) {
    const nearest = findNearestWalkable(grid, goalGrid)
    if (!nearest) return null
    goalGrid.x = nearest.x
    goalGrid.y = nearest.y
  }

  if (startGrid.x === goalGrid.x && startGrid.y === goalGrid.y) {
    return [goal]
  }

  const nodeMap = new Map<number, PathNode>()
  const closedSet = new Set<number>()
  const toIndex = (x: number, y: number) => y * grid.gridWidth + x

  const startNode: PathNode = {
    x: startGrid.x,
    y: startGrid.y,
    g: 0,
    f: heuristic(startGrid, goalGrid),
    parent: null,
  }
  nodeMap.set(toIndex(startNode.x, startNode.y), startNode)

  const open = new MinHeap<PathNode>()
  open.push(startNode.f, startNode)

  let iterations = 0

  while (open.size > 0 && iterations < maxIter) {
    iterations++
    const current = open.pop()!
    const currentIdx = toIndex(current.x, current.y)

    if (closedSet.has(currentIdx)) continue
    // Skip stale heap entries (node was re-pushed with a better g-cost)
    const best = nodeMap.get(currentIdx)
    if (best && current.g > best.g) continue
    closedSet.add(currentIdx)

    if (current.x === goalGrid.x && current.y === goalGrid.y) {
      const rawPath = reconstructPath(current, grid)
      return smoothPath(rawPath, grid)
    }

    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.dx
      const ny = current.y + dir.dy

      if (!grid.isWalkable(nx, ny)) continue

      // Prevent corner cutting
      if (dir.dx !== 0 && dir.dy !== 0) {
        if (
          !grid.isWalkable(current.x + dir.dx, current.y) ||
          !grid.isWalkable(current.x, current.y + dir.dy)
        ) {
          continue
        }
      }

      const nIdx = toIndex(nx, ny)
      if (closedSet.has(nIdx)) continue

      const tentativeG = current.g + dir.cost
      const existing = nodeMap.get(nIdx)

      if (!existing || tentativeG < existing.g) {
        const neighbor: PathNode = {
          x: nx,
          y: ny,
          g: tentativeG,
          f: tentativeG + heuristic({ x: nx, y: ny }, goalGrid),
          parent: current,
        }
        nodeMap.set(nIdx, neighbor)
        open.push(neighbor.f, neighbor)
      }
    }
  }

  return null
}
