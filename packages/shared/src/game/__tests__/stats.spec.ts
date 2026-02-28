import { describe, it, expect } from 'vitest'
import { getStatsAtLevel, calculateAttackTimings, applyResistance } from '../stats'
import { xpRequiredForLevel, respawnTimeMs } from '../combat-constants'
import { DefaultChampion } from '../../champions/default'

describe('getStatsAtLevel', () => {
  it('returns base stats at level 1', () => {
    const stats = getStatsAtLevel(DefaultChampion, 1)
    expect(stats.hp).toBe(600)
    expect(stats.ad).toBe(60)
    expect(stats.armor).toBe(30)
    expect(stats.magicResist).toBe(32)
    expect(stats.attackSpeed).toBe(0.625)
    expect(stats.moveSpeed).toBe(325)
    expect(stats.attackRange).toBe(125)
  })

  it('scales stats correctly at level 6', () => {
    const stats = getStatsAtLevel(DefaultChampion, 6)
    // hp = 600 + 102 * 5 = 1110
    expect(stats.hp).toBe(1110)
    // ad = 60 + 3.5 * 5 = 77.5
    expect(stats.ad).toBe(77.5)
    // armor = 30 + 4.5 * 5 = 52.5
    expect(stats.armor).toBe(52.5)
  })

  it('scales stats correctly at level 18', () => {
    const stats = getStatsAtLevel(DefaultChampion, 18)
    // hp = 600 + 102 * 17 = 2334
    expect(stats.hp).toBe(2334)
    // ad = 60 + 3.5 * 17 = 119.5
    expect(stats.ad).toBe(119.5)
    // armor = 30 + 4.5 * 17 = 106.5
    expect(stats.armor).toBe(106.5)
  })

  it('clamps level to 1-18 range', () => {
    const statsMin = getStatsAtLevel(DefaultChampion, 0)
    expect(statsMin.hp).toBe(600)

    const statsMax = getStatsAtLevel(DefaultChampion, 25)
    expect(statsMax.hp).toBe(2334) // same as level 18
  })
})

describe('calculateAttackTimings', () => {
  it('computes correct timings for base attack speed 0.625 with 30% windup', () => {
    const timings = calculateAttackTimings(0.625, 0.3)
    // totalMs = 1000 / 0.625 = 1600
    expect(timings.totalMs).toBe(1600)
    // windupMs = 1600 * 0.3 = 480
    expect(timings.windupMs).toBe(480)
    // damagePointMs = 1600 * 0.05 = 80
    expect(timings.damagePointMs).toBe(80)
    // recoveryMs = 1600 - 480 - 80 = 1040
    expect(timings.recoveryMs).toBe(1040)
  })

  it('computes correct timings for higher attack speed', () => {
    const timings = calculateAttackTimings(1.2, 0.3)
    // totalMs = 1000 / 1.2 ≈ 833.33
    expect(timings.totalMs).toBeCloseTo(833.33, 1)
    // windupMs ≈ 250
    expect(timings.windupMs).toBeCloseTo(250, 0)
    // damagePointMs ≈ 41.67
    expect(timings.damagePointMs).toBeCloseTo(41.67, 0)
    // recoveryMs ≈ 541.67
    expect(timings.recoveryMs).toBeCloseTo(541.67, 0)
  })
})

describe('applyResistance', () => {
  it('reduces 100 damage with 50 armor to 66.67', () => {
    const result = applyResistance(100, 50)
    expect(result).toBeCloseTo(66.67, 1)
  })

  it('reduces 100 damage with 100 armor to 50', () => {
    const result = applyResistance(100, 100)
    expect(result).toBe(50)
  })

  it('applies no reduction with 0 armor', () => {
    const result = applyResistance(100, 0)
    expect(result).toBe(100)
  })

  it('amplifies damage with negative resistance', () => {
    // resistance = -20 → damage = 100 * (2 - 100/(100-(-20))) = 100 * (2 - 100/120) ≈ 116.67
    const result = applyResistance(100, -20)
    expect(result).toBeCloseTo(116.67, 1)
  })

  it('computes correct damage for default champion stats: 60 AD vs 30 armor', () => {
    const result = applyResistance(60, 30)
    // 60 * (100/130) ≈ 46.15
    expect(result).toBeCloseTo(46.15, 1)
  })
})

describe('xpRequiredForLevel', () => {
  it('returns 0 for level 1', () => {
    expect(xpRequiredForLevel(1)).toBe(0)
  })

  it('returns 280 for level 2', () => {
    expect(xpRequiredForLevel(2)).toBe(280)
  })

  it('returns 2400 for level 6', () => {
    expect(xpRequiredForLevel(6)).toBe(2400)
  })

  it('returns 18360 for level 18', () => {
    expect(xpRequiredForLevel(18)).toBe(18360)
  })
})

describe('respawnTimeMs', () => {
  it('returns 12s for level 1', () => {
    expect(respawnTimeMs(1)).toBe(12000)
  })

  it('returns 22s for level 6', () => {
    expect(respawnTimeMs(6)).toBe(22000)
  })

  it('returns 46s for level 18', () => {
    expect(respawnTimeMs(18)).toBe(46000)
  })
})
