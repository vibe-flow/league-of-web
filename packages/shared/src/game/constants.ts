// =============================================================================
// Map dimensions & grid
// =============================================================================

export const MAP_WIDTH = 6000
export const MAP_HEIGHT = 1200

export const CELL_SIZE = 25
export const GRID_WIDTH = Math.ceil(MAP_WIDTH / CELL_SIZE) // 320
export const GRID_HEIGHT = Math.ceil(MAP_HEIGHT / CELL_SIZE) // 48

// =============================================================================
// Structures
// =============================================================================

export const NEXUS_RADIUS = 150
export const TURRET_RADIUS = 100

/** Blue base spawn center (clear of Nexus obstacle) */
export const BLUE_SPAWN = { x: 550, y: 600 } as const
/** Red base spawn center (clear of Nexus obstacle) */
export const RED_SPAWN = { x: 5450, y: 600 } as const

// =============================================================================
// Tower / Nexus stats & definitions
// =============================================================================

export type TowerTier = 'outer' | 'inner' | 'inhibitor'

export const TOWER_STATS: Record<
  TowerTier,
  { hp: number; ad: number; armor: number; magicResist: number; attackRange: number }
> = {
  outer: { hp: 3500, ad: 150, armor: 40, magicResist: 40, attackRange: 800 },
  inner: { hp: 3800, ad: 175, armor: 50, magicResist: 50, attackRange: 800 },
  inhibitor: { hp: 4000, ad: 200, armor: 60, magicResist: 60, attackRange: 800 },
} as const

export const NEXUS_STATS = {
  hp: 5500,
  armor: 50,
  magicResist: 50,
} as const

export interface TowerDefinition {
  id: string
  team: 'blue' | 'red'
  tier: TowerTier | 'nexus'
  position: { x: number; y: number }
  radius: number
  /** Destruction order per team: 0=outer, 1=inner, 2=inhibitor, 3=nexus */
  orderIndex: number
}

/**
 * All structures on the map. orderIndex 0 is the first tower the enemy team
 * must destroy (closest to center), increasing toward the nexus.
 */
export const TOWER_DEFINITIONS: TowerDefinition[] = [
  // Blue side — red team attacks these from center→base (B1 first)
  {
    id: 'tower_blue_0',
    team: 'blue',
    tier: 'outer',
    position: { x: 2100, y: 600 },
    radius: TURRET_RADIUS,
    orderIndex: 0,
  },
  {
    id: 'tower_blue_1',
    team: 'blue',
    tier: 'inner',
    position: { x: 1500, y: 600 },
    radius: TURRET_RADIUS,
    orderIndex: 1,
  },
  {
    id: 'tower_blue_2',
    team: 'blue',
    tier: 'inhibitor',
    position: { x: 800, y: 600 },
    radius: TURRET_RADIUS,
    orderIndex: 2,
  },
  {
    id: 'nexus_blue',
    team: 'blue',
    tier: 'nexus',
    position: { x: 300, y: 600 },
    radius: NEXUS_RADIUS,
    orderIndex: 3,
  },
  // Red side — blue team attacks these from center→base (A1 first)
  {
    id: 'tower_red_0',
    team: 'red',
    tier: 'outer',
    position: { x: 3900, y: 600 },
    radius: TURRET_RADIUS,
    orderIndex: 0,
  },
  {
    id: 'tower_red_1',
    team: 'red',
    tier: 'inner',
    position: { x: 4500, y: 600 },
    radius: TURRET_RADIUS,
    orderIndex: 1,
  },
  {
    id: 'tower_red_2',
    team: 'red',
    tier: 'inhibitor',
    position: { x: 5200, y: 600 },
    radius: TURRET_RADIUS,
    orderIndex: 2,
  },
  {
    id: 'nexus_red',
    team: 'red',
    tier: 'nexus',
    position: { x: 5700, y: 600 },
    radius: NEXUS_RADIUS,
    orderIndex: 3,
  },
]

// =============================================================================
// Map definition — obstacles, bushes, bases
// =============================================================================

import type { AramMapDefinition } from './types'

export const ARAM_MAP: AramMapDefinition = {
  width: MAP_WIDTH,
  height: MAP_HEIGHT,

  circleObstacles: [
    // Blue side structures
    { center: { x: 300, y: 600 }, radius: NEXUS_RADIUS }, // Blue Nexus
    { center: { x: 800, y: 600 }, radius: TURRET_RADIUS }, // T-B3
    { center: { x: 1500, y: 600 }, radius: TURRET_RADIUS }, // T-B2
    { center: { x: 2100, y: 600 }, radius: TURRET_RADIUS }, // T-B1

    // Red side structures
    { center: { x: 5700, y: 600 }, radius: NEXUS_RADIUS }, // Red Nexus
    { center: { x: 5200, y: 600 }, radius: TURRET_RADIUS }, // T-A3
    { center: { x: 4500, y: 600 }, radius: TURRET_RADIUS }, // T-A2
    { center: { x: 3900, y: 600 }, radius: TURRET_RADIUS }, // T-A1
  ],

  rectObstacles: [],

  bushZones: [
    // Blue inner bushes (between T-B3 and T-B2)
    { x: 1050, y: 80, width: 350, height: 150 },
    { x: 1050, y: 970, width: 350, height: 150 },
    // Blue outer bushes (between T-B2 and T-B1)
    { x: 1700, y: 80, width: 300, height: 150 },
    { x: 1700, y: 970, width: 300, height: 150 },
    // Center-left bushes
    { x: 2450, y: 60, width: 350, height: 160 },
    { x: 2450, y: 980, width: 350, height: 160 },
    // Center bushes (health relic area)
    { x: 2900, y: 100, width: 400, height: 170 },
    { x: 2900, y: 930, width: 400, height: 170 },
    // Center-right bushes
    { x: 3350, y: 60, width: 350, height: 160 },
    { x: 3350, y: 980, width: 350, height: 160 },
    // Red outer bushes (between T-A1 and T-A2)
    { x: 4100, y: 80, width: 300, height: 150 },
    { x: 4100, y: 970, width: 300, height: 150 },
    // Red inner bushes (between T-A2 and T-A3)
    { x: 4750, y: 80, width: 350, height: 150 },
    { x: 4750, y: 970, width: 350, height: 150 },
  ],
}

// =============================================================================
// Champion defaults (Phase 1 placeholder)
// =============================================================================

export const DEFAULT_MOVE_SPEED = 325
export const DEFAULT_CHAMPION_RADIUS = 50
export const DEFAULT_HP = 600
export const DEFAULT_MAX_HP = 600

// =============================================================================
// Pathfinding
// =============================================================================

export const CELL_WALKABLE = 0b00000001
export const CELL_BUSH = 0b00000010

export const MAX_ASTAR_ITERATIONS = 2000
export const WAYPOINT_REACH_THRESHOLD = 10

// =============================================================================
// Camera
// =============================================================================

export const CAMERA_DEFAULT_ZOOM = 1
export const CAMERA_MIN_ZOOM = 0.3
export const CAMERA_MAX_ZOOM = 2
export const CAMERA_ZOOM_STEP = 0.1
export const CAMERA_PAN_SPEED = 800 // world units/sec when panning
export const CAMERA_EDGE_THRESHOLD = 30 // px from screen edge to trigger pan

// =============================================================================
// Minimap
// =============================================================================

export const MINIMAP_SIZE = 180 // square minimap for diagonal display
export const MINIMAP_PADDING = 12

// =============================================================================
// Network / Game loop
// =============================================================================

export const TICK_RATE = 30
export const TICK_DURATION_MS = 1000 / TICK_RATE // ~33.33ms
export const TICK_DURATION_S = 1 / TICK_RATE
export const MAX_CATCH_UP_TICKS = 3

export const INTERPOLATION_DELAY_MS = 100 // render ~3 ticks behind server
export const SNAP_THRESHOLD = 2 // units — ignore small prediction errors
export const TELEPORT_THRESHOLD = 100 // units — snap instantly if too far off

// =============================================================================
// Match
// =============================================================================

export const COUNTDOWN_DURATION_MS = 3000
export const LOADING_TIMEOUT_MS = 60_000
export const MAX_PLAYERS_PER_MATCH = 10
export const MAX_PLAYERS_PHASE2 = 2 // Phase 2: only 2 players

// =============================================================================
// Colors (hex numbers for PixiJS)
// =============================================================================

export const COLORS = {
  LANE: 0xc2b280, // sandy beige
  WALL: 0x3a3a3a, // dark gray
  BLUE_BASE: 0x2060a0, // blue
  RED_BASE: 0xa02020, // red
  BUSH: 0x2d7a3a, // green
  TURRET_BLUE: 0x4488cc,
  TURRET_RED: 0xcc4444,
  NEXUS_BLUE: 0x3366aa,
  NEXUS_RED: 0xaa3333,
  CHAMPION_BLUE: 0x4499ff,
  CHAMPION_RED: 0xff4444,
  HEALTH_BAR_BG: 0x333333,
  HEALTH_BAR_FILL: 0x22cc44,
  HEALTH_BAR_BORDER: 0x000000,
  MINIMAP_BG: 0x1a1a2e,
  MINIMAP_LANE: 0x8b7355,
  MINIMAP_PLAYER: 0x44ff44,
  MOVE_INDICATOR: 0x44ff44,
  PATH_DEBUG: 0xffff00,
  GRID_BLOCKED: 0xff0000,
} as const
