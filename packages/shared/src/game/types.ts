/** A position in world space. */
export interface WorldPosition {
  x: number
  y: number
}

/** A position on the navigation grid. */
export interface GridCoord {
  x: number
  y: number
}

/** 2D vector. */
export interface Vec2 {
  x: number
  y: number
}

export type Team = 'blue' | 'red'

// =============================================================================
// Map definition
// =============================================================================

export interface CircleObstacle {
  center: { x: number; y: number }
  radius: number
}

export interface RectObstacle {
  x: number
  y: number
  width: number
  height: number
}

export interface AramMapDefinition {
  width: number
  height: number
  circleObstacles: CircleObstacle[]
  rectObstacles: RectObstacle[]
  bushZones: RectObstacle[]
}
