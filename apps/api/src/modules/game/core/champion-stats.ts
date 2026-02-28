import {
  type ChampionDefinition,
  type BaseStats,
  type AttackTimings,
  getStatsAtLevel,
  calculateAttackTimings,
  xpRequiredForLevel,
  MAX_LEVEL,
} from '@template-dev/shared'

export class ChampionStats {
  private _level = 1
  private _xp = 0
  private _effectiveStats: BaseStats

  constructor(private readonly definition: ChampionDefinition) {
    this._effectiveStats = getStatsAtLevel(definition, 1)
  }

  get level(): number {
    return this._level
  }

  get xp(): number {
    return this._xp
  }

  get effectiveStats(): BaseStats {
    return this._effectiveStats
  }

  /** XP needed to reach the next level (cumulative). */
  get xpToNextLevel(): number {
    if (this._level >= MAX_LEVEL) return 0
    return xpRequiredForLevel(this._level + 1)
  }

  getAttackTimings(): AttackTimings {
    return calculateAttackTimings(
      this._effectiveStats.attackSpeed,
      this.definition.baseWindupPercent,
    )
  }

  /**
   * Add XP and handle level-ups.
   * Returns the number of levels gained (0 if none).
   */
  addXp(amount: number): number {
    if (this._level >= MAX_LEVEL) return 0

    this._xp += amount
    let levelsGained = 0

    while (this._level < MAX_LEVEL) {
      const required = xpRequiredForLevel(this._level + 1)
      if (this._xp >= required) {
        this._level++
        levelsGained++
        this._effectiveStats = getStatsAtLevel(this.definition, this._level)
      } else {
        break
      }
    }

    return levelsGained
  }

  /** Recalculate stats (call after level changes or external modifiers). */
  recalculate(): void {
    this._effectiveStats = getStatsAtLevel(this.definition, this._level)
  }
}
