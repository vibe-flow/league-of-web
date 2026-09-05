import type { EntityState } from '@template-dev/shared'

/**
 * Maps game entity states to GLB animation clip names.
 *
 * LoL Model Viewer GLB files typically contain these clip names:
 * - Idle1, Idle2 — standing animations
 * - Run — movement
 * - Attack1, Attack2 — auto-attack variations
 * - Spell1, Spell2, Spell3, Spell4 — abilities (Q/W/E/R)
 * - Death — death animation
 * - Dance, Joke, Taunt, Laugh — emotes
 * - Recall — recall animation
 *
 * Clip names may vary per champion, so this module supports
 * per-champion overrides.
 */

export interface AnimationMapping {
  idle: string
  moving: string
  attacking: string
  dead: string
  respawning?: string
  spell1: string
  spell2: string
  spell3: string
  spell4: string
  dance?: string
  joke?: string
  taunt?: string
  laugh?: string
}

/** Default mapping for LoL Model Viewer GLB files. */
export const DEFAULT_ANIMATION_MAP: AnimationMapping = {
  idle: 'Idle1',
  moving: 'Run',
  attacking: 'Attack1',
  dead: 'Death',
  respawning: 'Idle1',
  spell1: 'Spell1',
  spell2: 'Spell2',
  spell3: 'Spell3',
  spell4: 'Spell4',
  dance: 'Dance',
  joke: 'Joke',
  taunt: 'Taunt',
  laugh: 'Laugh',
}

/** Per-champion overrides when clip names differ from defaults. */
const CHAMPION_ANIMATION_MAPS: Record<string, Partial<AnimationMapping>> = {
  // Example:
  // 'ahri': { idle: 'ahri_idle', attacking: 'ahri_attack1' },
}

/**
 * Get the animation mapping for a champion.
 * Falls back to defaults for any unmapped states.
 */
export function getAnimationMap(championId: string): AnimationMapping {
  const overrides = CHAMPION_ANIMATION_MAPS[championId] ?? {}
  return { ...DEFAULT_ANIMATION_MAP, ...overrides }
}

/**
 * Get the GLB clip name for a given entity state.
 */
export function getClipNameForState(championId: string, state: EntityState): string {
  const map = getAnimationMap(championId)
  const key = state as keyof AnimationMapping
  return map[key] ?? map.idle
}
