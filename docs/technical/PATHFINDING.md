# Pathfinding -- Technical Specification

## Table of Contents

1. [Overview](#1-overview)
2. [Navigation Grid](#2-navigation-grid)
3. [A\* Algorithm](#3-a-algorithm)
4. [Path Smoothing](#4-path-smoothing)
5. [Flowfield Pathfinding for Minions](#5-flowfield-pathfinding-for-minions)
6. [Local Avoidance (Steering Behaviors)](#6-local-avoidance-steering-behaviors)
7. [Performance Considerations](#7-performance-considerations)
8. [Integration with Game Loop](#8-integration-with-game-loop)
9. [Future: NavMesh](#9-future-navmesh)

---

## 1. Overview

### Why Pathfinding?

Every moving entity in the game needs pathfinding. Champions move via right-click commands, minions march down the lane autonomously, and all units must navigate around obstacles without clipping through walls or structures. Even on a straightforward ARAM map, pathfinding is essential for three reasons:

1. **Click-to-move (Champions):** The player right-clicks a target position. The server must compute a valid path from the champion's current position to the destination, routing around turrets, walls, and the lane boundaries.

2. **Minion AI:** Minion waves spawn every 30 seconds and march toward the enemy Nexus. They need an efficient way to follow the lane without individual expensive path calculations.

3. **Obstacle Avoidance:** The ARAM map contains turrets (6 total), two Nexus structures, lane walls, and narrow passages. Units cannot walk through any of these.

### ARAM Map Topology

The ARAM map is simpler than a full Summoner's Rift map, but still has non-trivial geometry:

```
 ~800 units wide
 <------------->

 ################################################################################
 #                                                                              #
 #  [Nexus B]  [T-B3]         [T-B2]         [T-B1]     |     [T-A1]         [T-A2]         [T-A3]  [Nexus A]  #
 #     @@         O              O              O        |        O              O              O        @@      #
 #     @@                                                |                                               @@      #
 #                ~~~~~~bush~~~~~~                       |                       ~~~~~~bush~~~~~~                 #
 #                                                       |                                                       #
 ################################################################################

 <------------------------------ ~8000 units ------------------------------------->

 Legend:
   #   = Wall (non-walkable)
   @@  = Nexus structure (non-walkable, large footprint)
   O   = Turret (non-walkable, ~100 unit radius)
   ~~  = Bush (walkable, affects vision only)
   |   = Center of map
```

Key obstacles a path must avoid:

| Obstacle   | Count | Approximate Radius | Notes                             |
| ---------- | ----- | ------------------ | --------------------------------- |
| Lane walls | 2     | N/A (boundaries)   | Top and bottom edges of the lane  |
| Turrets    | 6     | ~100 units         | 3 per team, positioned along lane |
| Nexus      | 2     | ~150 units         | One at each end                   |
| Base walls | 2     | N/A                | Enclose spawn areas at each end   |

Because the map is essentially a wide corridor, most paths are near-linear. The pathfinding system does not need to solve complex multi-region problems -- it just needs to route around the handful of circular/rectangular obstacles within the lane.

### Architecture Overview

Pathfinding runs **server-side only**. The server is authoritative (as described in the Architecture doc). The client sends movement intentions; the server computes the path, validates it, and broadcasts waypoints.

```
Client                          Server
  |                               |
  |-- right-click (x, y) ------->|
  |                               |-- PathfindingSystem.requestPath(unit, target)
  |                               |-- A* computes path on NavigationGrid
  |                               |-- Path smoothing removes redundant waypoints
  |                               |-- Unit.waypoints = smoothedPath
  |                               |
  |<-- state update (waypoints) --|
  |                               |
  |-- interpolate movement ------>|  (client-side prediction)
```

---

## 2. Navigation Grid

For the ARAM MVP, a **grid-based** approach is simpler and faster to implement than a full navigation mesh. The map's rectangular shape maps naturally onto a 2D grid.

### Grid Parameters

| Parameter   | Value               | Rationale                                           |
| ----------- | ------------------- | --------------------------------------------------- |
| Cell size   | 25 units            | Small enough for precise pathing around turrets     |
| Grid width  | 320 cells (8000/25) | Covers the full lane length                         |
| Grid height | 32 cells (800/25)   | Covers the full lane width                          |
| Total cells | 10,240              | Small enough for fast A\* and flowfield computation |

A 25-unit cell size was chosen as a balance between precision and performance. A champion (radius ~50 units) occupies roughly a 2x2 area of cells. A turret (radius ~100 units) blocks a 4x4 cluster. This resolution is fine-grained enough to find valid paths through the ~200-unit gaps between turrets and lane walls.

### Grid Coordinate System

```
  (0,0) ────────────────────────────────────────── (319, 0)
    │                                                  │
    │   World origin (0, 0) maps to grid (0, 0)        │
    │   World point (x, y) maps to:                    │
    │     gridX = floor(x / cellSize)                  │
    │     gridY = floor(y / cellSize)                  │
    │                                                  │
  (0,31) ─────────────────────────────────────── (319, 31)
```

### Cell States

Each cell stores a single byte indicating its walkability and properties:

| Bit | Meaning                    |
| --- | -------------------------- |
| 0   | Walkable (1) / Blocked (0) |
| 1   | Bush (1 = inside a bush)   |
| 2-7 | Reserved for future use    |

### TypeScript Implementation

```typescript
/** Represents a position on the navigation grid. */
interface GridCoord {
  x: number
  y: number
}

/** Represents a position in world space. */
interface WorldPosition {
  x: number
  y: number
}

/** Obstacle definition used during grid generation. */
interface Obstacle {
  /** Center of the obstacle in world coordinates. */
  center: WorldPosition
  /** Radius of the obstacle in world units. */
  radius: number
}

/** Rectangular obstacle (walls, base areas). */
interface RectObstacle {
  /** Top-left corner in world coordinates. */
  x: number
  y: number
  width: number
  height: number
}

/** Map definition used to generate the grid. */
interface AramMapDefinition {
  /** Total map width in world units (lane length). */
  width: number
  /** Total map height in world units (lane width). */
  height: number
  /** Circular obstacles: turrets, nexus structures. */
  circleObstacles: Obstacle[]
  /** Rectangular obstacles: walls, base enclosures. */
  rectObstacles: RectObstacle[]
  /** Bush zones (walkable, but flagged for vision). */
  bushZones: RectObstacle[]
}

const CELL_WALKABLE = 0b00000001
const CELL_BUSH = 0b00000010

class NavigationGrid {
  /** Number of cells along the X axis (lane length). */
  readonly gridWidth: number
  /** Number of cells along the Y axis (lane width). */
  readonly gridHeight: number
  /** Size of each cell in world units. */
  readonly cellSize: number
  /**
   * Flat array storing cell flags. Index = y * gridWidth + x.
   * Using a Uint8Array for cache-friendly, compact storage.
   */
  private cells: Uint8Array

  constructor(mapDef: AramMapDefinition, cellSize: number = 25) {
    this.cellSize = cellSize
    this.gridWidth = Math.ceil(mapDef.width / cellSize)
    this.gridHeight = Math.ceil(mapDef.height / cellSize)
    this.cells = new Uint8Array(this.gridWidth * this.gridHeight)

    this.generate(mapDef)
  }

  // ---------------------------------------------------------------------------
  // Grid generation
  // ---------------------------------------------------------------------------

  /** Build the grid from the map definition. */
  private generate(mapDef: AramMapDefinition): void {
    // Step 1: Mark every cell as walkable by default.
    this.cells.fill(CELL_WALKABLE)

    // Step 2: Carve out circular obstacles (turrets, nexus).
    for (const obs of mapDef.circleObstacles) {
      this.blockCircle(obs.center, obs.radius)
    }

    // Step 3: Carve out rectangular obstacles (walls).
    for (const rect of mapDef.rectObstacles) {
      this.blockRect(rect)
    }

    // Step 4: Flag bush cells (still walkable).
    for (const bush of mapDef.bushZones) {
      this.flagBush(bush)
    }
  }

  /** Mark all cells overlapping a circle as non-walkable. */
  private blockCircle(center: WorldPosition, radius: number): void {
    const minGX = Math.max(0, Math.floor((center.x - radius) / this.cellSize))
    const maxGX = Math.min(this.gridWidth - 1, Math.ceil((center.x + radius) / this.cellSize))
    const minGY = Math.max(0, Math.floor((center.y - radius) / this.cellSize))
    const maxGY = Math.min(this.gridHeight - 1, Math.ceil((center.y + radius) / this.cellSize))

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        // Cell center in world space.
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

  /** Mark all cells inside a rectangle as non-walkable. */
  private blockRect(rect: RectObstacle): void {
    const minGX = Math.max(0, Math.floor(rect.x / this.cellSize))
    const maxGX = Math.min(this.gridWidth - 1, Math.floor((rect.x + rect.width) / this.cellSize))
    const minGY = Math.max(0, Math.floor(rect.y / this.cellSize))
    const maxGY = Math.min(this.gridHeight - 1, Math.floor((rect.y + rect.height) / this.cellSize))

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        this.cells[gy * this.gridWidth + gx] &= ~CELL_WALKABLE
      }
    }
  }

  /** Flag cells inside a rectangle as bush. */
  private flagBush(rect: RectObstacle): void {
    const minGX = Math.max(0, Math.floor(rect.x / this.cellSize))
    const maxGX = Math.min(this.gridWidth - 1, Math.floor((rect.x + rect.width) / this.cellSize))
    const minGY = Math.max(0, Math.floor(rect.y / this.cellSize))
    const maxGY = Math.min(this.gridHeight - 1, Math.floor((rect.y + rect.height) / this.cellSize))

    for (let gy = minGY; gy <= maxGY; gy++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        this.cells[gy * this.gridWidth + gx] |= CELL_BUSH
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Query methods
  // ---------------------------------------------------------------------------

  /** Check if a grid cell is walkable. */
  isWalkable(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return false
    }
    return (this.cells[gy * this.gridWidth + gx] & CELL_WALKABLE) !== 0
  }

  /** Check if a grid cell is inside a bush. */
  isBush(gx: number, gy: number): boolean {
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return false
    }
    return (this.cells[gy * this.gridWidth + gx] & CELL_BUSH) !== 0
  }

  /** Convert world coordinates to grid coordinates. */
  worldToGrid(pos: WorldPosition): GridCoord {
    return {
      x: Math.floor(pos.x / this.cellSize),
      y: Math.floor(pos.y / this.cellSize),
    }
  }

  /** Convert grid coordinates to world coordinates (cell center). */
  gridToWorld(coord: GridCoord): WorldPosition {
    return {
      x: (coord.x + 0.5) * this.cellSize,
      y: (coord.y + 0.5) * this.cellSize,
    }
  }

  /** Get the raw cell flags at a grid coordinate. */
  getCellFlags(gx: number, gy: number): number {
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return 0
    }
    return this.cells[gy * this.gridWidth + gx]
  }
}
```

### Grid Visualization (Debug)

During development, the grid can be rendered as a debug overlay on the PixiJS canvas. Each cell is drawn as a colored rectangle:

```
  Green  = walkable
  Red    = blocked (wall/turret)
  Teal   = bush (walkable + bush flag)
```

This is invaluable for verifying that turret radii and wall boundaries are correctly mapped onto the grid.

---

## 3. A\* Algorithm

A\* is the standard choice for single-unit pathfinding on a grid. It combines the actual cost from the start with a heuristic estimate to the goal, guaranteeing an optimal path (given an admissible heuristic).

### Algorithm Summary

```
OPEN   = priority queue (sorted by f = g + h, lowest first)
CLOSED = set of already-visited nodes

1. Add start node to OPEN with g=0, h=heuristic(start, goal)
2. While OPEN is not empty:
   a. Pop the node N with the lowest f value
   b. If N == goal, reconstruct the path and return it
   c. Add N to CLOSED
   d. For each walkable neighbor M of N:
      - If M is in CLOSED, skip
      - Compute tentative g = N.g + cost(N, M)
      - If M is not in OPEN, or tentative g < M.g:
        - Set M.parent = N, M.g = tentative g, M.f = M.g + heuristic(M, goal)
        - Add/update M in OPEN
3. If OPEN is empty and goal not reached, no path exists
```

### Heuristic Function

We use **Euclidean distance** as the heuristic. It is admissible (never overestimates) for 8-directional movement, ensuring A\* finds an optimal path:

```typescript
function heuristic(a: GridCoord, b: GridCoord): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}
```

> **Why not Manhattan distance?** Manhattan distance is only admissible for 4-directional grids. Since we allow 8-directional (diagonal) movement, Manhattan would overestimate diagonal costs and could produce suboptimal paths. Euclidean is admissible for any movement model.

### Neighbor Generation (8-Directional)

```
  NW  N  NE        (-1,-1) (0,-1) (1,-1)
   W  .  E    =>   (-1, 0)        (1, 0)
  SW  S  SE        (-1, 1) (0, 1) (1, 1)
```

Diagonal movement costs `sqrt(2) ~ 1.414` while cardinal movement costs `1.0`. We also enforce **corner-cutting prevention**: a unit cannot move diagonally between two blocked cells.

```typescript
/** The 8 movement directions with their associated costs. */
const DIRECTIONS: { dx: number; dy: number; cost: number }[] = [
  { dx: 0, dy: -1, cost: 1.0 }, // N
  { dx: 1, dy: 0, cost: 1.0 }, // E
  { dx: 0, dy: 1, cost: 1.0 }, // S
  { dx: -1, dy: 0, cost: 1.0 }, // W
  { dx: 1, dy: -1, cost: 1.4142 }, // NE
  { dx: 1, dy: 1, cost: 1.4142 }, // SE
  { dx: -1, dy: 1, cost: 1.4142 }, // SW
  { dx: -1, dy: -1, cost: 1.4142 }, // NW
]
```

### Priority Queue

A\* needs an efficient min-priority queue. A binary heap is the standard choice. For our grid size (10,240 cells), performance is not a bottleneck -- even a simple sorted-insert array would work -- but a binary heap is cleaner:

```typescript
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
```

### Complete A\* Implementation

```typescript
interface PathNode {
  /** Grid X coordinate. */
  x: number
  /** Grid Y coordinate. */
  y: number
  /** Cost from start to this node. */
  g: number
  /** Estimated total cost (g + heuristic). */
  f: number
  /** Parent node for path reconstruction. */
  parent: PathNode | null
}

/**
 * Find a path from `start` to `goal` on the navigation grid using A*.
 *
 * @param grid      - The navigation grid.
 * @param start     - Start position in world coordinates.
 * @param goal      - Goal position in world coordinates.
 * @param maxIter   - Maximum iterations before giving up (prevents frame stalls).
 * @returns           Array of world positions forming the path, or null if no path.
 */
function findPath(
  grid: NavigationGrid,
  start: WorldPosition,
  goal: WorldPosition,
  maxIter: number = 2000,
): WorldPosition[] | null {
  const startGrid = grid.worldToGrid(start)
  const goalGrid = grid.worldToGrid(goal)

  // If goal is not walkable, find the nearest walkable cell.
  if (!grid.isWalkable(goalGrid.x, goalGrid.y)) {
    const nearest = findNearestWalkable(grid, goalGrid)
    if (!nearest) return null
    goalGrid.x = nearest.x
    goalGrid.y = nearest.y
  }

  // Quick exit: start == goal.
  if (startGrid.x === goalGrid.x && startGrid.y === goalGrid.y) {
    return [goal]
  }

  // Node storage -- indexed by flat grid index for O(1) lookup.
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

    // Already processed (duplicate entry in the heap)?
    if (closedSet.has(currentIdx)) continue
    closedSet.add(currentIdx)

    // Goal reached?
    if (current.x === goalGrid.x && current.y === goalGrid.y) {
      return reconstructPath(current, grid)
    }

    // Expand neighbors.
    for (const dir of DIRECTIONS) {
      const nx = current.x + dir.dx
      const ny = current.y + dir.dy

      if (!grid.isWalkable(nx, ny)) continue

      // Prevent corner cutting: for diagonal moves, both adjacent cardinal
      // cells must be walkable.
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

  // No path found (or iteration limit reached).
  return null
}

/** Reconstruct the path by walking parent pointers from goal to start. */
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

/**
 * Find the nearest walkable cell to the given grid coordinate.
 * Uses a BFS spiral outward from the target.
 */
function findNearestWalkable(grid: NavigationGrid, target: GridCoord): GridCoord | null {
  const visited = new Set<number>()
  const queue: GridCoord[] = [target]
  const toIndex = (x: number, y: number) => y * grid.gridWidth + x

  visited.add(toIndex(target.x, target.y))

  while (queue.length > 0) {
    const current = queue.shift()!

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
```

### A\* on the ARAM Map: Practical Example

```
 Start (S) must navigate around turret (T) to reach Goal (G):

  ################################
  #                              #
  #   S ----+                    #
  #         |                    #
  #         +---TTTTT---+       #
  #             TTTTT   |       #
  #             TTTTT   +--- G  #
  #                              #
  ################################

  A* finds the optimal path around the turret.
  Path smoothing (Section 4) then removes the grid-aligned zigzag.
```

---

## 4. Path Smoothing

Raw A\* paths on a grid follow cell centers, producing staircase-like movement that looks robotic. Path smoothing removes unnecessary intermediate waypoints to produce natural-looking paths.

### The Problem

```
  Raw A* path (grid-aligned):          Smoothed path:

    S                                    S
    |\                                    \
    | \                                    \
    |  \                                    \
    +---+                                    \
         \                                    \
          +---+                                \
               \                                \
                G                                G
```

### Approach: Line-of-Sight Raycast

The simplest effective smoothing method is an iterative line-of-sight check:

1. Start with the full A\* path: `[P0, P1, P2, ..., Pn]`.
2. Set the "anchor" to `P0`.
3. Try to draw a straight line from the anchor to `P2`, then `P3`, etc.
4. If a line-of-sight check between the anchor and `Pi` fails (the line crosses a non-walkable cell), keep `P(i-1)` as a waypoint and make it the new anchor.
5. Repeat until the goal is reached.

This reduces a 20-waypoint grid path to typically 2-4 waypoints.

### Line-of-Sight Check (Bresenham's Line)

We walk a line between two grid cells using Bresenham's algorithm, checking every cell along the way. If any cell is non-walkable, line-of-sight is blocked.

```typescript
/**
 * Check whether a straight line between two grid cells is entirely walkable.
 * Uses a Bresenham-like traversal (DDA) with a fat line to account for unit radius.
 */
function hasLineOfSight(grid: NavigationGrid, from: GridCoord, to: GridCoord): boolean {
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

    // For diagonal steps, check both adjacent cells (no corner-cutting).
    if (e2 > -dy && e2 < dx) {
      // Diagonal step -- verify adjacent cells are walkable.
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
```

### Path Smoothing Implementation

```typescript
/**
 * Remove unnecessary waypoints from an A* path using line-of-sight checks.
 *
 * @param path  - The raw A* path in world coordinates.
 * @param grid  - The navigation grid for line-of-sight queries.
 * @returns       A smoothed path with fewer waypoints.
 */
function smoothPath(path: WorldPosition[], grid: NavigationGrid): WorldPosition[] {
  if (path.length <= 2) return path

  const smoothed: WorldPosition[] = [path[0]]
  let anchor = 0

  while (anchor < path.length - 1) {
    let farthestVisible = anchor + 1

    // Look ahead as far as possible while maintaining line-of-sight.
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
```

### Before and After

```
  A* raw path (12 waypoints):

  S -> (100,50) -> (125,50) -> (150,75) -> (175,100) -> (200,100)
    -> (225,100) -> (250,125) -> (275,150) -> (300,175) -> (325,200)
    -> (350,200) -> G(375,200)

  Smoothed path (3 waypoints):

  S -> (200,100) -> G(375,200)

  The intermediate points were redundant; line-of-sight was clear from S to
  (200,100) and from (200,100) to G.
```

---

## 5. Flowfield Pathfinding for Minions

Running A\* for every minion individually is wasteful. In a single ARAM wave, 6-7 minions all share the same destination: the enemy Nexus (or the lane end). A **flowfield** computes a single vector field that all minions can follow.

### How Flowfields Work

```
  1. Pick the GOAL cell (e.g., enemy Nexus position).
  2. BFS outward from the goal, computing cost to reach the goal for each cell.
  3. For each cell, compute a direction vector pointing toward the neighboring
     cell with the lowest cost.
  4. Any minion at any cell simply reads the direction and moves that way.

  Cost map (BFS from goal G):         Direction field:

  5 4 4 4 3 3 3 2 2 1 0              . . . . . . . . . . G
  5 4 # # # 3 3 2 2 1 0              > v # # # > > > > > ^
  5 4 4 4 3 3 3 2 2 1 0              . . . . . . . . . > ^

  # = obstacle (turret)
  Each cell stores a 2D unit vector pointing "downhill" toward the goal.
```

### Why Flowfields for ARAM?

| Factor                          | A\* per Minion     | Flowfield           |
| ------------------------------- | ------------------ | ------------------- |
| Minions per wave                | 6-7 A\* calls      | 1 BFS computation   |
| Pathfinding cost per wave       | O(n \* grid_size)  | O(grid_size) once   |
| Memory                          | Low                | One grid of vectors |
| Handles dynamic obstacles       | Recompute per unit | Recompute one field |
| Natural lane-following behavior | Needs tuning       | Built-in            |

Since minion waves spawn at the same position and head to the same destination, one flowfield per team direction is enough. We recompute it only when the map topology changes (e.g., a turret is destroyed).

### TypeScript Implementation

```typescript
interface Vec2 {
  x: number
  y: number
}

class FlowField {
  /** Cost to reach the goal from each cell. MAX_SAFE_INTEGER = unreachable. */
  private costField: Float32Array
  /** Direction vectors -- stored as interleaved (dx, dy) pairs. */
  private directionField: Float32Array

  readonly gridWidth: number
  readonly gridHeight: number

  constructor(
    private grid: NavigationGrid,
    goal: WorldPosition,
  ) {
    this.gridWidth = grid.gridWidth
    this.gridHeight = grid.gridHeight
    this.costField = new Float32Array(this.gridWidth * this.gridHeight)
    // 2 floats per cell (dx, dy).
    this.directionField = new Float32Array(this.gridWidth * this.gridHeight * 2)

    this.compute(goal)
  }

  // ---------------------------------------------------------------------------
  // Computation
  // ---------------------------------------------------------------------------

  /** Compute the flowfield via BFS from the goal. */
  private compute(goal: WorldPosition): void {
    const goalGrid = this.grid.worldToGrid(goal)

    // Step 1: Initialize cost field to "infinity".
    this.costField.fill(Number.MAX_SAFE_INTEGER)
    this.directionField.fill(0)

    // Step 2: BFS from goal outward.
    const toIndex = (x: number, y: number) => y * this.gridWidth + x
    const goalIdx = toIndex(goalGrid.x, goalGrid.y)
    this.costField[goalIdx] = 0

    // BFS queue stores flat indices.
    const queue: number[] = [goalIdx]
    let head = 0

    while (head < queue.length) {
      const idx = queue[head++]
      const cx = idx % this.gridWidth
      const cy = (idx - cx) / this.gridWidth
      const currentCost = this.costField[idx]

      for (const dir of DIRECTIONS) {
        const nx = cx + dir.dx
        const ny = cy + dir.dy

        if (!this.grid.isWalkable(nx, ny)) continue

        // Prevent corner cutting on diagonals.
        if (dir.dx !== 0 && dir.dy !== 0) {
          if (!this.grid.isWalkable(cx + dir.dx, cy) || !this.grid.isWalkable(cx, cy + dir.dy)) {
            continue
          }
        }

        const nIdx = toIndex(nx, ny)
        const newCost = currentCost + dir.cost

        if (newCost < this.costField[nIdx]) {
          this.costField[nIdx] = newCost
          queue.push(nIdx)
        }
      }
    }

    // Step 3: Compute direction vectors.
    // For each cell, find the neighbor with the lowest cost and point toward it.
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const idx = toIndex(x, y)

        if (!this.grid.isWalkable(x, y)) continue
        if (this.costField[idx] === Number.MAX_SAFE_INTEGER) continue

        let bestCost = this.costField[idx]
        let bestDx = 0
        let bestDy = 0

        for (const dir of DIRECTIONS) {
          const nx = x + dir.dx
          const ny = y + dir.dy

          if (nx < 0 || nx >= this.gridWidth || ny < 0 || ny >= this.gridHeight) continue

          const nIdx = toIndex(nx, ny)
          if (this.costField[nIdx] < bestCost) {
            bestCost = this.costField[nIdx]
            bestDx = dir.dx
            bestDy = dir.dy
          }
        }

        // Normalize the direction vector.
        const len = Math.sqrt(bestDx * bestDx + bestDy * bestDy)
        if (len > 0) {
          this.directionField[idx * 2] = bestDx / len
          this.directionField[idx * 2 + 1] = bestDy / len
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Get the flow direction at a world position. */
  getDirection(worldPos: WorldPosition): Vec2 {
    const gx = Math.floor(worldPos.x / this.grid.cellSize)
    const gy = Math.floor(worldPos.y / this.grid.cellSize)

    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return { x: 0, y: 0 }
    }

    const idx = gy * this.gridWidth + gx
    return {
      x: this.directionField[idx * 2],
      y: this.directionField[idx * 2 + 1],
    }
  }

  /** Get the cost to reach the goal from a world position. */
  getCost(worldPos: WorldPosition): number {
    const gx = Math.floor(worldPos.x / this.grid.cellSize)
    const gy = Math.floor(worldPos.y / this.grid.cellSize)

    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return Number.MAX_SAFE_INTEGER
    }

    return this.costField[gy * this.gridWidth + gx]
  }

  /**
   * Get a smoothly interpolated direction using bilinear interpolation
   * of the four surrounding cells. Prevents snapping when crossing
   * cell boundaries.
   */
  getDirectionSmooth(worldPos: WorldPosition): Vec2 {
    const fx = worldPos.x / this.grid.cellSize - 0.5
    const fy = worldPos.y / this.grid.cellSize - 0.5
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const x1 = x0 + 1
    const y1 = y0 + 1
    const tx = fx - x0
    const ty = fy - y0

    const d00 = this.getRawDirection(x0, y0)
    const d10 = this.getRawDirection(x1, y0)
    const d01 = this.getRawDirection(x0, y1)
    const d11 = this.getRawDirection(x1, y1)

    // Bilinear interpolation.
    const dx =
      d00.x * (1 - tx) * (1 - ty) + d10.x * tx * (1 - ty) + d01.x * (1 - tx) * ty + d11.x * tx * ty

    const dy =
      d00.y * (1 - tx) * (1 - ty) + d10.y * tx * (1 - ty) + d01.y * (1 - tx) * ty + d11.y * tx * ty

    // Normalize.
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 0.0001) return { x: 0, y: 0 }
    return { x: dx / len, y: dy / len }
  }

  /** Get direction at a grid coordinate (unchecked). */
  private getRawDirection(gx: number, gy: number): Vec2 {
    if (gx < 0 || gx >= this.gridWidth || gy < 0 || gy >= this.gridHeight) {
      return { x: 0, y: 0 }
    }
    const idx = gy * this.gridWidth + gx
    return {
      x: this.directionField[idx * 2],
      y: this.directionField[idx * 2 + 1],
    }
  }
}
```

### Managing Flowfields

```typescript
class FlowFieldManager {
  private fields: Map<string, FlowField> = new Map()

  constructor(private grid: NavigationGrid) {}

  /**
   * Get or create a flowfield for the given goal.
   * For ARAM, there are typically just two: one per team's Nexus.
   */
  getField(goalKey: string, goalPos: WorldPosition): FlowField {
    let field = this.fields.get(goalKey)
    if (!field) {
      field = new FlowField(this.grid, goalPos)
      this.fields.set(goalKey, field)
    }
    return field
  }

  /** Invalidate all cached flowfields (e.g., when a turret is destroyed). */
  invalidateAll(): void {
    this.fields.clear()
  }

  /** Invalidate a specific flowfield. */
  invalidate(goalKey: string): void {
    this.fields.delete(goalKey)
  }
}
```

### Usage in Minion AI

```typescript
function updateMinion(minion: MinionEntity, flowFieldManager: FlowFieldManager, dt: number): void {
  // Determine which flowfield to use based on team.
  const goalKey = minion.team === 'blue' ? 'red_nexus' : 'blue_nexus'
  const goalPos =
    minion.team === 'blue'
      ? { x: 7600, y: 400 } // Red Nexus position
      : { x: 400, y: 400 } // Blue Nexus position

  const field = flowFieldManager.getField(goalKey, goalPos)
  const direction = field.getDirectionSmooth(minion.position)

  // Move the minion along the flowfield.
  const speed = minion.moveSpeed // ~325 units/sec
  minion.position.x += direction.x * speed * dt
  minion.position.y += direction.y * speed * dt
}
```

---

## 6. Local Avoidance (Steering Behaviors)

Pathfinding gives units a high-level route, but it does not prevent them from overlapping each other. Local avoidance handles unit-to-unit interactions so that champions and minions do not stack on top of each other.

### The Problem

Without local avoidance:

```
  All 6 minions follow the same flowfield direction and converge
  into a single point, visually stacking:

         M M M
         M M M    -->    MMMMMM (all on top of each other)
```

With local avoidance:

```
         M M M
         M M M    -->    M  M  M
                         M  M  M   (spread out, natural formation)
```

### Steering Behaviors (Craig Reynolds Model)

We implement three behaviors and combine them with weighted summation:

| Behavior       | Purpose                                                    | Weight |
| -------------- | ---------------------------------------------------------- | ------ |
| **Seek**       | Move toward the target (path waypoint/flowfield direction) | 1.0    |
| **Separation** | Push away from nearby units to prevent overlap             | 1.5    |
| **Arrival**    | Slow down when approaching the destination                 | 1.0    |

### TypeScript Implementation

```typescript
interface SteeringOutput {
  x: number
  y: number
}

interface Unit {
  position: WorldPosition
  velocity: Vec2
  radius: number
  moveSpeed: number
  team: 'blue' | 'red'
}

// --------------------------------------------------------------------------
// Seek: steer toward a target position.
// --------------------------------------------------------------------------

function seek(unit: Unit, target: WorldPosition): SteeringOutput {
  const dx = target.x - unit.position.x
  const dy = target.y - unit.position.y
  const dist = Math.sqrt(dx * dx + dy * dy)

  if (dist < 0.001) return { x: 0, y: 0 }

  // Desired velocity = direction to target * max speed.
  const desiredX = (dx / dist) * unit.moveSpeed
  const desiredY = (dy / dist) * unit.moveSpeed

  // Steering = desired - current velocity.
  return {
    x: desiredX - unit.velocity.x,
    y: desiredY - unit.velocity.y,
  }
}

// --------------------------------------------------------------------------
// Separation: push away from nearby units.
// --------------------------------------------------------------------------

/**
 * Compute a separation force that pushes the unit away from neighbors
 * that are too close. Uses an inverse-distance weighting so closer
 * neighbors produce stronger repulsion.
 *
 * @param unit       - The unit to compute separation for.
 * @param neighbors  - Nearby units (from spatial hash query).
 * @param minDist    - The distance below which separation activates.
 */
function separation(unit: Unit, neighbors: Unit[], minDist: number = 100): SteeringOutput {
  let forceX = 0
  let forceY = 0

  for (const other of neighbors) {
    if (other === unit) continue

    const dx = unit.position.x - other.position.x
    const dy = unit.position.y - other.position.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    // Combined radii + buffer.
    const combinedRadius = unit.radius + other.radius
    const effectiveDist = Math.max(dist - combinedRadius, 0.1)

    if (effectiveDist < minDist) {
      // Inverse-distance weighting: closer = stronger push.
      const strength = (minDist - effectiveDist) / minDist
      const nx = dx / (dist || 1)
      const ny = dy / (dist || 1)
      forceX += nx * strength
      forceY += ny * strength
    }
  }

  return { x: forceX * unit.moveSpeed, y: forceY * unit.moveSpeed }
}

// --------------------------------------------------------------------------
// Arrival: slow down when approaching the destination.
// --------------------------------------------------------------------------

function arrival(unit: Unit, target: WorldPosition, slowRadius: number = 150): SteeringOutput {
  const dx = target.x - unit.position.x
  const dy = target.y - unit.position.y
  const dist = Math.sqrt(dx * dx + dy * dy)

  if (dist < 0.001) return { x: 0, y: 0 }

  // Scale speed down within the slow radius.
  const speed = dist < slowRadius ? unit.moveSpeed * (dist / slowRadius) : unit.moveSpeed

  const desiredX = (dx / dist) * speed
  const desiredY = (dy / dist) * speed

  return {
    x: desiredX - unit.velocity.x,
    y: desiredY - unit.velocity.y,
  }
}

// --------------------------------------------------------------------------
// Combined steering.
// --------------------------------------------------------------------------

interface SteeringWeights {
  seek: number
  separation: number
  arrival: number
}

const DEFAULT_WEIGHTS: SteeringWeights = {
  seek: 1.0,
  separation: 1.5,
  arrival: 1.0,
}

/**
 * Compute the final steering force for a unit by blending all behaviors.
 */
function computeSteering(
  unit: Unit,
  target: WorldPosition,
  neighbors: Unit[],
  isArriving: boolean,
  weights: SteeringWeights = DEFAULT_WEIGHTS,
): Vec2 {
  let steerX = 0
  let steerY = 0

  // Seek or arrival.
  if (isArriving) {
    const arr = arrival(unit, target)
    steerX += arr.x * weights.arrival
    steerY += arr.y * weights.arrival
  } else {
    const sk = seek(unit, target)
    steerX += sk.x * weights.seek
    steerY += sk.y * weights.seek
  }

  // Separation.
  const sep = separation(unit, neighbors)
  steerX += sep.x * weights.separation
  steerY += sep.y * weights.separation

  // Clamp to max speed.
  const mag = Math.sqrt(steerX * steerX + steerY * steerY)
  if (mag > unit.moveSpeed) {
    steerX = (steerX / mag) * unit.moveSpeed
    steerY = (steerY / mag) * unit.moveSpeed
  }

  return { x: steerX, y: steerY }
}
```

### Circle-Circle Collision Resolution

In addition to soft steering forces, we apply hard collision resolution after movement to guarantee no two units overlap:

```typescript
/**
 * Resolve overlaps between all nearby unit pairs.
 * Call this AFTER applying velocity to positions each tick.
 */
function resolveCollisions(units: Unit[], spatialHash: SpatialHash): void {
  for (const unit of units) {
    const nearby = spatialHash.query(
      unit.position.x,
      unit.position.y,
      unit.radius + 100, // query radius covers possible overlaps
    )

    for (const other of nearby) {
      if (other === unit) continue

      const dx = other.position.x - unit.position.x
      const dy = other.position.y - unit.position.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const minDist = unit.radius + other.radius

      if (dist < minDist && dist > 0.001) {
        // Push units apart equally.
        const overlap = (minDist - dist) / 2
        const nx = dx / dist
        const ny = dy / dist

        unit.position.x -= nx * overlap
        unit.position.y -= ny * overlap
        other.position.x += nx * overlap
        other.position.y += ny * overlap
      }
    }
  }
}
```

---

## 7. Performance Considerations

### 7.1 Path Cache

Many path requests share identical (or nearly identical) start/goal pairs. A lightweight cache avoids recomputation:

```typescript
class PathCache {
  private cache: Map<string, { path: WorldPosition[]; timestamp: number }> = new Map()
  /** Cache entries older than this (in ms) are evicted. */
  private ttl: number
  private maxSize: number

  constructor(ttl: number = 2000, maxSize: number = 200) {
    this.ttl = ttl
    this.maxSize = maxSize
  }

  /** Quantize a position to the nearest grid cell for cache-key generation. */
  private quantize(pos: WorldPosition, cellSize: number): string {
    const qx = Math.floor(pos.x / cellSize)
    const qy = Math.floor(pos.y / cellSize)
    return `${qx},${qy}`
  }

  /** Generate a cache key from start and goal. */
  private makeKey(start: WorldPosition, goal: WorldPosition, cellSize: number): string {
    return `${this.quantize(start, cellSize)}->${this.quantize(goal, cellSize)}`
  }

  get(start: WorldPosition, goal: WorldPosition, cellSize: number): WorldPosition[] | null {
    const key = this.makeKey(start, goal, cellSize)
    const entry = this.cache.get(key)

    if (!entry) return null

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key)
      return null
    }

    return entry.path
  }

  set(start: WorldPosition, goal: WorldPosition, cellSize: number, path: WorldPosition[]): void {
    // Evict oldest if at capacity.
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
      }
    }

    const key = this.makeKey(start, goal, cellSize)
    this.cache.set(key, { path, timestamp: Date.now() })
  }

  /** Remove all entries (e.g., when the grid changes). */
  clear(): void {
    this.cache.clear()
  }
}
```

### 7.2 Iteration Budget Per Tick

A\* should never stall the game loop. We cap iterations per `findPath` call and, if the budget is exceeded, we can either return the best partial path or spread the computation across multiple ticks:

```typescript
/** Maximum A* iterations per tick across all path requests combined. */
const MAX_ITERATIONS_PER_TICK = 5000

/**
 * Per-request limit. On the ARAM grid (320x32 = 10,240 cells), most
 * paths complete in under 500 iterations. 2,000 is a generous ceiling.
 */
const MAX_ITERATIONS_PER_REQUEST = 2000
```

At 30 Hz with a 10,240-cell grid, even a worst-case A\* traversal takes well under 1 ms. This budget exists as a safety net, not a practical constraint for ARAM.

### 7.3 Spatial Hash for Neighbor Queries

Local avoidance needs to find nearby units. Iterating over all units is O(n^2). A spatial hash grid reduces this to O(1) average-case per query:

```typescript
class SpatialHash {
  /** Maps cell keys to arrays of entities in that cell. */
  private buckets: Map<number, Unit[]> = new Map()
  private cellSize: number

  constructor(cellSize: number = 150) {
    this.cellSize = cellSize
  }

  /** Clear all buckets. Call at the start of each tick. */
  clear(): void {
    this.buckets.clear()
  }

  /** Insert a unit into the hash. */
  insert(unit: Unit): void {
    const key = this.hash(unit.position.x, unit.position.y)
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = []
      this.buckets.set(key, bucket)
    }
    bucket.push(unit)
  }

  /** Query all units within `radius` of (x, y). */
  query(x: number, y: number, radius: number): Unit[] {
    const results: Unit[] = []
    const minCX = Math.floor((x - radius) / this.cellSize)
    const maxCX = Math.floor((x + radius) / this.cellSize)
    const minCY = Math.floor((y - radius) / this.cellSize)
    const maxCY = Math.floor((y + radius) / this.cellSize)

    const radiusSq = radius * radius

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const key = this.hashCoord(cx, cy)
        const bucket = this.buckets.get(key)
        if (!bucket) continue

        for (const unit of bucket) {
          const dx = unit.position.x - x
          const dy = unit.position.y - y
          if (dx * dx + dy * dy <= radiusSq) {
            results.push(unit)
          }
        }
      }
    }

    return results
  }

  private hash(x: number, y: number): number {
    return this.hashCoord(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize))
  }

  /** Combine two ints into a single hash. */
  private hashCoord(cx: number, cy: number): number {
    // Cantor pairing function (works for positive and small negative values).
    const a = cx >= 0 ? 2 * cx : -2 * cx - 1
    const b = cy >= 0 ? 2 * cy : -2 * cy - 1
    return ((a + b) * (a + b + 1)) / 2 + b
  }
}
```

### 7.4 ARAM-Specific Simplifications

The ARAM map layout provides inherent performance advantages over more complex maps:

| Property                | Impact                                                        |
| ----------------------- | ------------------------------------------------------------- |
| Single lane             | Paths are mostly linear; A\* completes very quickly           |
| Few obstacles           | 6 turrets + 2 nexus = small blocked area in the grid          |
| Small grid              | 320 x 32 = 10,240 cells fits in L1 cache                      |
| Predictable minion flow | One flowfield per team, recomputed rarely                     |
| Max ~30 moving units    | 10 champions + ~20 minions -- spatial hash is almost overkill |

### Performance Budget Summary

| Operation                      | Frequency      | Estimated Cost |
| ------------------------------ | -------------- | -------------- |
| A\* pathfind (single request)  | Per click      | < 0.5 ms       |
| Path smoothing                 | Per A\* result | < 0.1 ms       |
| Flowfield generation           | On map change  | < 2 ms         |
| Flowfield lookup (per minion)  | Per tick       | < 0.001 ms     |
| Spatial hash rebuild           | Per tick       | < 0.05 ms      |
| Local avoidance (all units)    | Per tick       | < 0.2 ms       |
| **Total pathfinding per tick** | **30 Hz**      | **< 1 ms**     |

---

## 8. Integration with Game Loop

### Request Queue Architecture

Pathfinding requests are queued and processed at the start of each server tick, before movement updates. This ensures all units have fresh paths before they move.

```typescript
interface PathRequest {
  /** The unit requesting the path. */
  unitId: string
  /** Start position in world coordinates. */
  start: WorldPosition
  /** Goal position in world coordinates. */
  goal: WorldPosition
  /** Callback invoked when the path is ready. */
  onComplete: (path: WorldPosition[] | null) => void
  /** Tick when the request was submitted. */
  requestTick: number
}

class PathfindingSystem {
  private grid: NavigationGrid
  private pathCache: PathCache
  private flowFieldManager: FlowFieldManager
  private spatialHash: SpatialHash
  private requestQueue: PathRequest[] = []

  constructor(mapDef: AramMapDefinition) {
    this.grid = new NavigationGrid(mapDef)
    this.pathCache = new PathCache()
    this.flowFieldManager = new FlowFieldManager(this.grid)
    this.spatialHash = new SpatialHash(150)
  }

  /** Submit a pathfinding request (called by champion movement handler). */
  requestPath(
    unitId: string,
    start: WorldPosition,
    goal: WorldPosition,
    onComplete: (path: WorldPosition[] | null) => void,
  ): void {
    this.requestQueue.push({ unitId, start, goal, onComplete, requestTick: 0 })
  }

  /**
   * Process all queued requests. Called once per server tick, before
   * movement updates.
   */
  processRequests(): void {
    let iterationsUsed = 0

    while (this.requestQueue.length > 0 && iterationsUsed < MAX_ITERATIONS_PER_TICK) {
      const req = this.requestQueue.shift()!

      // 1. Check the cache first.
      const cached = this.pathCache.get(req.start, req.goal, this.grid.cellSize)
      if (cached) {
        req.onComplete(cached)
        continue
      }

      // 2. Run A* with a per-request iteration limit.
      const remainingBudget = Math.min(
        MAX_ITERATIONS_PER_REQUEST,
        MAX_ITERATIONS_PER_TICK - iterationsUsed,
      )

      const rawPath = findPath(this.grid, req.start, req.goal, remainingBudget)
      iterationsUsed += remainingBudget // Conservative estimate.

      if (rawPath) {
        // 3. Smooth the path.
        const smoothedPath = smoothPath(rawPath, this.grid)

        // 4. Cache the result.
        this.pathCache.set(req.start, req.goal, this.grid.cellSize, smoothedPath)

        req.onComplete(smoothedPath)
      } else {
        req.onComplete(null)
      }
    }

    // If requests remain (budget exhausted), they carry over to the next tick.
    // This should essentially never happen on an ARAM map.
  }

  /** Called when the grid topology changes (turret destroyed, etc.). */
  onMapChanged(): void {
    this.pathCache.clear()
    this.flowFieldManager.invalidateAll()
  }

  /** Get the flowfield manager for minion AI. */
  getFlowFieldManager(): FlowFieldManager {
    return this.flowFieldManager
  }

  /** Get the spatial hash for local avoidance queries. */
  getSpatialHash(): SpatialHash {
    return this.spatialHash
  }

  /** Get the navigation grid (for debug visualization, etc.). */
  getGrid(): NavigationGrid {
    return this.grid
  }
}
```

### Game Loop Integration

```typescript
/**
 * Simplified game loop showing where pathfinding fits in
 * the server tick cycle.
 */
class GameLoop {
  private pathfinding: PathfindingSystem
  private units: Map<string, GameUnit> = new Map()
  private tickRate = 30 // Hz
  private tickInterval = 1000 / 30 // ~33.33 ms

  constructor(mapDef: AramMapDefinition) {
    this.pathfinding = new PathfindingSystem(mapDef)
  }

  /** One server tick. Called 30 times per second. */
  tick(dt: number): void {
    // Phase 1: Process inputs (movement commands, ability casts, etc.).
    this.processInputs()

    // Phase 2: Process pathfinding requests (A* for champions).
    this.pathfinding.processRequests()

    // Phase 3: Rebuild the spatial hash with current positions.
    const spatialHash = this.pathfinding.getSpatialHash()
    spatialHash.clear()
    for (const unit of this.units.values()) {
      spatialHash.insert(unit)
    }

    // Phase 4: Update movement for all units.
    for (const unit of this.units.values()) {
      this.updateUnitMovement(unit, dt, spatialHash)
    }

    // Phase 5: Resolve collisions (hard constraint).
    resolveCollisions([...this.units.values()], spatialHash)

    // Phase 6: Combat, abilities, etc. (out of scope for this doc).
    // ...

    // Phase 7: Broadcast state to clients.
    this.broadcastState()
  }

  /** Move a unit along its waypoints with local avoidance. */
  private updateUnitMovement(unit: GameUnit, dt: number, spatialHash: SpatialHash): void {
    if (unit.waypoints.length === 0) return

    const target = unit.waypoints[0]
    const dx = target.x - unit.position.x
    const dy = target.y - unit.position.y
    const distToWaypoint = Math.sqrt(dx * dx + dy * dy)

    // Check if we've reached the current waypoint.
    const waypointReachThreshold = 5 // units
    if (distToWaypoint < waypointReachThreshold) {
      unit.waypoints.shift()
      if (unit.waypoints.length === 0) {
        unit.velocity = { x: 0, y: 0 }
        return
      }
    }

    // Determine if this is the final waypoint (use arrival behavior).
    const isLastWaypoint = unit.waypoints.length === 1

    // Query neighbors for local avoidance.
    const neighbors = spatialHash.query(
      unit.position.x,
      unit.position.y,
      150, // neighborhood radius
    )

    // Compute blended steering.
    const steering = computeSteering(unit, unit.waypoints[0], neighbors, isLastWaypoint)

    // Apply steering to velocity.
    unit.velocity.x = steering.x
    unit.velocity.y = steering.y

    // Apply velocity to position.
    unit.position.x += unit.velocity.x * dt
    unit.position.y += unit.velocity.y * dt

    // Clamp to walkable area (prevent wall clipping due to steering forces).
    this.clampToWalkable(unit)
  }

  /** Ensure the unit is on a walkable cell after movement. */
  private clampToWalkable(unit: GameUnit): void {
    const grid = this.pathfinding.getGrid()
    const gCoord = grid.worldToGrid(unit.position)

    if (!grid.isWalkable(gCoord.x, gCoord.y)) {
      // Push the unit back to the nearest walkable cell center.
      const nearest = findNearestWalkable(grid, gCoord)
      if (nearest) {
        const worldPos = grid.gridToWorld(nearest)
        unit.position.x = worldPos.x
        unit.position.y = worldPos.y
      }
    }
  }

  private processInputs(): void {
    /* ... */
  }
  private broadcastState(): void {
    /* ... */
  }
}
```

### Movement Interpolation (Client-Side)

The client receives waypoint updates from the server and interpolates the unit's position between them for smooth visual movement:

```typescript
/**
 * Client-side movement interpolation.
 * The server sends waypoints; the client smoothly moves the sprite
 * along those waypoints at the unit's move speed.
 */
class ClientMovementInterpolator {
  private waypoints: WorldPosition[] = []
  private currentWaypointIndex = 0
  private moveSpeed = 0

  /** Called when the server sends updated waypoints. */
  setWaypoints(waypoints: WorldPosition[], moveSpeed: number): void {
    this.waypoints = waypoints
    this.currentWaypointIndex = 0
    this.moveSpeed = moveSpeed
  }

  /**
   * Update the visual position of the entity each render frame.
   *
   * @param currentPos  - Current rendered position.
   * @param dt          - Time since last frame (seconds).
   * @returns             The new rendered position.
   */
  update(currentPos: WorldPosition, dt: number): WorldPosition {
    if (this.currentWaypointIndex >= this.waypoints.length) {
      return currentPos
    }

    const target = this.waypoints[this.currentWaypointIndex]
    const dx = target.x - currentPos.x
    const dy = target.y - currentPos.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    const step = this.moveSpeed * dt

    if (dist <= step) {
      // Reached this waypoint; advance to the next.
      this.currentWaypointIndex++
      return { x: target.x, y: target.y }
    }

    // Move toward the waypoint.
    return {
      x: currentPos.x + (dx / dist) * step,
      y: currentPos.y + (dy / dist) * step,
    }
  }

  /** Whether the unit has reached its final destination. */
  isFinished(): boolean {
    return this.currentWaypointIndex >= this.waypoints.length
  }
}
```

### Tick Lifecycle Summary

```
  Server Tick (33.33 ms budget @ 30 Hz)
  ======================================

  [  0.0 ms] Process player inputs (movement commands, ability casts)
             -> Queue pathfinding requests for move commands
  [  0.5 ms] Process pathfinding queue (A* + smoothing for champions)
  [  1.0 ms] Rebuild spatial hash
  [  1.5 ms] Update unit movement (waypoint following + steering)
             -> Minions: flowfield lookup + steering
             -> Champions: waypoint following + steering
  [  2.5 ms] Resolve hard collisions
  [  3.0 ms] Combat / abilities / game logic
  [ ... ms ] Broadcast state snapshot to all clients
  [<33.3 ms] Tick complete
```

---

## 9. Future: NavMesh

The grid-based system described above is well-suited for the ARAM map. However, if the game later introduces larger maps with more complex geometry (a Summoner's Rift-like map with jungle areas, multiple lanes, and irregular terrain), a **Navigation Mesh (NavMesh)** would be a better choice.

### Why NavMesh Over Grid for Complex Maps

| Aspect          | Grid (Current)                  | NavMesh (Future)                        |
| --------------- | ------------------------------- | --------------------------------------- |
| Memory          | O(width \* height) cells        | O(polygon_count), much smaller          |
| Path quality    | Grid-aligned, needs smoothing   | Naturally smooth (polygon edges)        |
| Complex terrain | Many blocked cells, large grids | Few polygons cover the same area        |
| Generation      | Simple (iterate cells)          | Complex (polygon decomposition)         |
| Pathfinding     | A\* on cells                    | A\* on polygon graph + funnel algorithm |
| Implementation  | ~500 lines TypeScript           | ~2000+ lines or use a library           |

### When to Upgrade

Upgrade to NavMesh when any of these conditions arise:

- A new map with **non-rectangular walkable regions** (jungle paths, curved walls).
- Map size exceeds **100,000 grid cells** (where A\* becomes noticeably slower).
- Need for **precise polygon-edge movement** (e.g., units sliding along walls smoothly).

### NavMesh Architecture (Brief)

```
  1. Define walkable polygons (convex) covering all navigable areas.
  2. Build an adjacency graph: polygons connected through shared edges.
  3. A* runs on the polygon graph (much fewer nodes than a grid).
  4. The Funnel Algorithm converts the polygon corridor into a precise path
     with smooth turns around polygon vertices.
```

For the ARAM MVP, this complexity is unnecessary. The grid works perfectly and is simpler to implement, debug, and maintain. NavMesh should be planned as a Phase 8+ feature if a Summoner's Rift mode is ever built.

### Library Options

If NavMesh is needed later, consider:

- **recast-navigation** (compiled to WASM): The industry standard (used in Unity, Unreal). A WebAssembly build can be called from Node.js. Handles mesh generation, pathfinding, and crowd simulation.
- **Custom implementation**: Only if specific constraints require it. The Funnel Algorithm and Delaunay triangulation are well-documented but non-trivial to implement correctly.

---

## Appendix A: File Organization

Proposed file layout within the game server module:

```
apps/api/src/modules/game/
├── pathfinding/
│   ├── NavigationGrid.ts          # Grid generation and queries
│   ├── AStar.ts                   # A* pathfinding algorithm
│   ├── PathSmoothing.ts           # Line-of-sight path smoothing
│   ├── FlowField.ts              # Flowfield generation and queries
│   ├── FlowFieldManager.ts       # Caching / lifecycle for flowfields
│   ├── PathCache.ts              # Path result caching
│   ├── PathfindingSystem.ts      # Top-level orchestrator
│   ├── SpatialHash.ts            # Spatial hash for neighbor queries
│   ├── Steering.ts               # Steering behaviors (seek, separation, arrival)
│   ├── CollisionResolution.ts    # Circle-circle overlap resolution
│   ├── types.ts                  # Shared interfaces (GridCoord, Vec2, etc.)
│   └── __tests__/
│       ├── NavigationGrid.test.ts
│       ├── AStar.test.ts
│       ├── FlowField.test.ts
│       └── Steering.test.ts
└── ...
```

## Appendix B: Key Constants

```typescript
/** All pathfinding-related constants in one place. */
export const PATHFINDING_CONSTANTS = {
  /** Navigation grid cell size in world units. */
  CELL_SIZE: 25,

  /** Maximum A* iterations per individual path request. */
  MAX_ITERATIONS_PER_REQUEST: 2000,

  /** Maximum total A* iterations across all requests per server tick. */
  MAX_ITERATIONS_PER_TICK: 5000,

  /** Path cache TTL in milliseconds. */
  PATH_CACHE_TTL: 2000,

  /** Path cache maximum entries. */
  PATH_CACHE_MAX_SIZE: 200,

  /** Spatial hash cell size for local avoidance queries. */
  SPATIAL_HASH_CELL_SIZE: 150,

  /** Neighborhood radius for separation steering. */
  SEPARATION_RADIUS: 100,

  /** Radius within which arrival behavior begins decelerating. */
  ARRIVAL_SLOW_RADIUS: 150,

  /** Distance threshold to consider a waypoint "reached". */
  WAYPOINT_REACH_THRESHOLD: 5,

  /** Default unit collision radius (champions). */
  DEFAULT_UNIT_RADIUS: 50,

  /** Minion collision radius. */
  MINION_RADIUS: 25,

  /** Steering behavior weights. */
  STEERING_WEIGHTS: {
    SEEK: 1.0,
    SEPARATION: 1.5,
    ARRIVAL: 1.0,
  },
} as const
```
