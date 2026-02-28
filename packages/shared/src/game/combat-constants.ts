// =============================================================================
// XP & Leveling
// =============================================================================

export const MAX_LEVEL = 18
export const PASSIVE_XP_PER_SECOND = 5

export const KILL_XP_BASE = 200
export const KILL_XP_PER_VICTIM_LEVEL = 50

/**
 * Cumulative XP required to reach each level.
 * Index 0 = XP needed for level 2, index 1 = level 3, etc.
 * Beyond the table, each level adds previous delta + 100.
 */
export const XP_THRESHOLDS: readonly number[] = [
  280, // Lvl 2
  660, // Lvl 3
  1140, // Lvl 4
  1720, // Lvl 5
  2400, // Lvl 6
  3180, // Lvl 7
  4060, // Lvl 8
  5040, // Lvl 9
  6120, // Lvl 10
  7300, // Lvl 11
  8580, // Lvl 12
  9960, // Lvl 13
  11440, // Lvl 14
  13020, // Lvl 15
  14700, // Lvl 16
  16480, // Lvl 17
  18360, // Lvl 18
] as const

/** Returns the cumulative XP required to reach the given level. */
export function xpRequiredForLevel(level: number): number {
  if (level <= 1) return 0
  const idx = level - 2
  if (idx < XP_THRESHOLDS.length) return XP_THRESHOLDS[idx]
  return XP_THRESHOLDS[XP_THRESHOLDS.length - 1] // cap at max
}

// =============================================================================
// Death & Respawn
// =============================================================================

export const RESPAWN_BASE_SECONDS = 10
export const RESPAWN_PER_LEVEL_SECONDS = 2

/** Calculate respawn time in milliseconds for a given level. */
export function respawnTimeMs(level: number): number {
  return (RESPAWN_BASE_SECONDS + RESPAWN_PER_LEVEL_SECONDS * level) * 1000
}

// =============================================================================
// Regeneration
// =============================================================================

/** HP regen rate when standing in base (fraction of maxHP per second). */
export const BASE_REGEN_HP_PERCENT_PER_SEC = 0.1

/** MP regen rate when standing in base (fraction of maxMP per second). */
export const BASE_REGEN_MP_PERCENT_PER_SEC = 0.1

/** Radius around spawn point that counts as "in base" for fast regen. */
export const BASE_ZONE_RADIUS = 300

// =============================================================================
// Auto-Attack
// =============================================================================

/** Damage point is always 5% of total attack time. */
export const DAMAGE_POINT_PERCENT = 0.05
