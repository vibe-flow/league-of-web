import { EntityState } from '@template-dev/shared'
import type { ChampionRenderer3D } from './ChampionRenderer3D'
import { getAnimationMap, type AnimationMapping } from '../assets/AnimationMap'
import type { AbilitySlot } from '@/stores/game-settings.store'

/**
 * Crossfade durations (seconds) per transition type.
 * Shorter = more responsive, longer = smoother.
 */
function getFadeTime(from: EntityState, to: EntityState): number {
  if (to === EntityState.Dead) return 0.05
  if (from === EntityState.Dead) return 0.1
  if (from === EntityState.Idle && to === EntityState.Moving) return 0.12
  if (from === EntityState.Moving && to === EntityState.Idle) return 0.15
  if (to === EntityState.Attacking) return 0.1
  if (from === EntityState.Attacking) return 0.1
  return 0.15
}

/**
 * Centralized animation controller for a champion entity.
 *
 * Single entry point for all animation decisions. Tracks the entity's
 * current state and decides which clip to play, handling priorities
 * between looping state animations and one-shot animations (spells, emotes).
 *
 * Priority (high → low):
 *   1. One-shot (spell cast, emote) — locks until finished
 *   2. Death — plays once, stays clamped
 *   3. State-based loop (attacking > moving > idle)
 */
export class AnimationController {
  private currentState: EntityState = EntityState.Idle
  private isPlayingOneShot = false
  private animMap: AnimationMapping

  constructor(
    private readonly renderer: ChampionRenderer3D,
    championAlias: string = '',
  ) {
    this.animMap = getAnimationMap(championAlias)
  }

  /** Update the animation mapping when champion changes. */
  setChampion(championAlias: string): void {
    this.animMap = getAnimationMap(championAlias)
  }

  /**
   * Set the entity state and play the corresponding looping animation.
   * Ignored while a one-shot animation is playing (spell/emote).
   */
  setState(state: EntityState): void {
    if (!this.renderer.hasModel) return

    // Death overrides everything
    if (state === EntityState.Dead && this.currentState !== EntityState.Dead) {
      const fade = getFadeTime(this.currentState, state)
      this.currentState = state
      this.isPlayingOneShot = false
      this.renderer.playOneShotAnimation(this.animMap.dead, undefined, fade)
      return
    }

    // Respawn: reset and go back to idle
    if (state !== EntityState.Dead && this.currentState === EntityState.Dead) {
      const fade = getFadeTime(this.currentState, state)
      this.currentState = state
      this.isPlayingOneShot = false
      this.renderer.playAnimation(this.animMap.idle, fade)
      return
    }

    // Don't interrupt one-shot animations — but track the state for resume
    if (this.isPlayingOneShot) {
      this.currentState = state
      return
    }

    if (state === this.currentState) return

    const fade = getFadeTime(this.currentState, state)
    this.currentState = state

    const clip = this.getClipForState(state)
    this.renderer.playAnimation(clip, fade)
  }

  /**
   * Play a one-shot animation (spell, emote), then resume the current state.
   */
  playOneShot(clipName: string): void {
    if (!this.renderer.hasModel) return
    if (this.currentState === EntityState.Dead) return

    this.isPlayingOneShot = true
    this.renderer.playOneShotAnimation(clipName, () => {
      this.isPlayingOneShot = false
      // Resume the correct state animation (may be Run if still moving)
      if (this.currentState !== EntityState.Dead) {
        const resumeClip = this.getClipForState(this.currentState)
        this.renderer.playAnimation(resumeClip)
      }
    })
  }

  /** Cast a spell by ability slot (0=Q, 1=W, 2=E, 3=R). */
  castSpell(slot: AbilitySlot): void {
    const key = `spell${slot + 1}` as keyof AnimationMapping
    const clip = (this.animMap[key] as string) ?? `Spell${slot + 1}`
    this.playOneShot(clip)
  }

  /** Update the animation mixer — call every frame. */
  update(dt: number): void {
    this.renderer.updateAnimation(dt)
  }

  private getClipForState(state: EntityState): string {
    switch (state) {
      case EntityState.Moving:
        return this.animMap.moving
      case EntityState.Attacking:
        return this.animMap.attacking
      case EntityState.Dead:
        return this.animMap.dead
      case EntityState.Respawning:
        return this.animMap.respawning ?? this.animMap.idle
      case EntityState.Idle:
      default:
        return this.animMap.idle
    }
  }
}
