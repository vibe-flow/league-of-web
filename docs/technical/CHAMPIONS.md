# Champions — Technical Specification

This document defines the champion system for the ARAM game mode, covering champion
data structures, stat calculations, the ability framework, damage pipeline, buff/debuff
management, cooldown mechanics, and the champion registry. All code is TypeScript shared
between client and server via the monorepo.

---

## Table of Contents

1. [Champion Definition Structure](#1-champion-definition-structure)
2. [Stats Calculation](#2-stats-calculation)
3. [Ability System Architecture](#3-ability-system-architecture)
4. [Damage Pipeline](#4-damage-pipeline)
5. [Buff / Debuff System](#5-buffdebuff-system)
6. [Cooldown System](#6-cooldown-system)
7. [Example Champion](#7-example-champion)
8. [Champion Registry](#8-champion-registry)
9. [File Structure](#9-file-structure)

---

## 1. Champion Definition Structure

Every champion in the game is described by a single `ChampionDefinition` object. These
definitions live in the shared package so both the server (authoritative simulation) and
the client (prediction / UI) reference the exact same data.

### BaseStats

`BaseStats` contains every numeric stat a champion has at level 1 before any items or
buffs are applied.

```typescript
/** Base numeric stats for a champion at level 1. */
export interface BaseStats {
  /** Maximum health points. */
  hp: number
  /** Maximum mana points. */
  mp: number
  /** Attack damage (physical auto-attack power). */
  ad: number
  /** Ability power (scales magic-based abilities). */
  ap: number
  /** Armor — reduces incoming physical damage. */
  armor: number
  /** Magic resistance — reduces incoming magical damage. */
  magicResist: number
  /** Attack speed (attacks per second). */
  attackSpeed: number
  /** Movement speed (units per second). */
  moveSpeed: number
  /** Auto-attack range (units). */
  attackRange: number
  /** Health regeneration per second. */
  hpRegen: number
  /** Mana regeneration per second. */
  mpRegen: number
  /** Critical strike chance (0.0 – 1.0). */
  critChance: number
}
```

### StatsPerLevel

`StatsPerLevel` uses the same shape as `BaseStats` but every field represents the
_per-level growth_ rather than an absolute value. Critical strike chance growth is
almost always `0` — it scales through items instead.

```typescript
/**
 * Per-level growth values. Added once for each level above 1.
 * Uses Partial because not every stat necessarily grows per level.
 */
export type StatsPerLevel = Partial<BaseStats>
```

### ChampionDefinition

```typescript
export interface ChampionDefinition {
  /** Unique string identifier, e.g. "ezreal", "ashe". */
  id: string
  /** Display name shown in the UI, e.g. "Ezreal". */
  name: string
  /** Level-1 base stats. */
  baseStats: BaseStats
  /** Per-level stat growth. Missing keys default to 0 growth. */
  statsPerLevel: StatsPerLevel
  /** Ordered array of abilities: [Q, W, E, R]. */
  abilities: [AbilityDefinition, AbilityDefinition, AbilityDefinition, AbilityDefinition]
}
```

Key design notes:

- `id` is the canonical key used in the registry, network messages, and database rows.
- `abilities` is a fixed-length tuple so indexing by ability slot is type-safe.
- Passive abilities, if needed, are modelled as a permanent buff applied at game start
  rather than as a fifth ability slot.

---

## 2. Stats Calculation

### Level Scaling Formula

Stats grow linearly with level:

```
stat(N) = base + growth * (N - 1)
```

Where `N` is the champion's current level (1-18). At level 1 the growth term is zero so
the champion has exactly their base stats.

### getStatsAtLevel

```typescript
/**
 * Compute the full stat block for a champion at the given level.
 * Does NOT include item bonuses — call applyItemBonuses() afterwards.
 */
export function getStatsAtLevel(definition: ChampionDefinition, level: number): BaseStats {
  const { baseStats, statsPerLevel } = definition
  const n = Math.max(1, Math.min(level, 18)) // clamp 1–18

  const result = { ...baseStats }

  for (const key of Object.keys(statsPerLevel) as (keyof BaseStats)[]) {
    const growth = statsPerLevel[key] ?? 0
    result[key] = baseStats[key] + growth * (n - 1)
  }

  return result
}
```

### Item Stat Modifiers

Items provide flat bonuses that are summed _after_ level scaling. The formula becomes:

```
effective stat = stat(N) + sum(item flat bonuses for that stat)
```

```typescript
export interface ItemStatModifier {
  stat: keyof BaseStats
  flat: number
}

/**
 * Apply item bonuses on top of level-scaled stats.
 * Mutates and returns the same object for convenience.
 */
export function applyItemBonuses(stats: BaseStats, items: ItemStatModifier[]): BaseStats {
  for (const mod of items) {
    stats[mod.stat] += mod.flat
  }
  return stats
}
```

Percentage-based item modifiers (e.g. Rabadon's Deathcap 35% bonus AP) are applied in a
second pass after all flat bonuses have been summed. This avoids order-dependent stacking
issues.

```typescript
export interface ItemPercentModifier {
  stat: keyof BaseStats
  /** Expressed as a multiplier, e.g. 0.35 for +35%. */
  percent: number
}

export function applyPercentModifiers(
  stats: BaseStats,
  modifiers: ItemPercentModifier[],
): BaseStats {
  for (const mod of modifiers) {
    stats[mod.stat] *= 1 + mod.percent
  }
  return stats
}
```

### Full Stat Resolution Order

```
1.  Start with baseStats
2.  Apply per-level growth        → stat(N)
3.  Sum all flat item bonuses     → stat(N) + flat
4.  Apply percent item bonuses    → (stat(N) + flat) * (1 + pct)
5.  Apply buff/debuff modifiers   → final effective stat
```

---

## 3. Ability System Architecture

### 3.1 AbilityDefinition

```typescript
export type AbilityKey = 'Q' | 'W' | 'E' | 'R'

export type TargetType =
  | 'skillshot' // fires a projectile in a direction
  | 'targeted' // requires clicking an enemy entity
  | 'aoe_ground' // targets a ground location (AoE circle/cone)
  | 'self_buff' // cast on self, no target required
  | 'dash' // moves the caster toward cursor / target

export interface AbilityDefinition {
  /** Unique ability identifier, e.g. "ezreal_q". */
  id: string
  /** Display name, e.g. "Mystic Shot". */
  name: string
  /** Keyboard key (slot) this ability is bound to. */
  key: AbilityKey
  /**
   * Cooldown in seconds per ability rank (index 0 = rank 1).
   * Array length is the max rank for this ability (typically 5 for QWE, 3 for R).
   */
  cooldown: number[]
  /**
   * Mana cost per rank. Same indexing as cooldown.
   */
  manaCost: number[]
  /** Cast range in game units. 0 means self-cast / global. */
  range: number
  /** Targeting paradigm — drives input handling and validation. */
  targetType: TargetType
  /** Damage / heal scaling values per rank (see ScalingValue). */
  scaling: ScalingValue
  /** Server-side ability logic. Only imported in the API app. */
  execute: AbilityExecutor
}
```

### 3.2 ScalingValue

Most abilities deal damage (or heal) according to a base amount that increases per rank
plus ratios that scale with the caster's AD and/or AP.

```typescript
export interface ScalingValue {
  /** Base damage / heal per rank (index 0 = rank 1). */
  base: number[]
  /** Fraction of total AD added. 1.0 = 100% AD ratio. */
  adRatio: number
  /** Fraction of total AP added. 1.0 = 100% AP ratio. */
  apRatio: number
}
```

Resolved at cast time:

```typescript
export function resolveScaling(
  scaling: ScalingValue,
  rank: number,
  casterStats: BaseStats,
): number {
  const base = scaling.base[rank - 1] ?? 0
  return base + scaling.adRatio * casterStats.ad + scaling.apRatio * casterStats.ap
}
```

### 3.3 AbilityExecutor

The executor is the function that runs on the server when an ability is cast. It receives
the game context and a target descriptor, then uses helper methods on `AbilityContext` to
mutate game state.

```typescript
export type AbilityExecutor = (
  ctx: AbilityContext,
  caster: EntityHandle,
  target: AbilityTarget,
  rank: number,
) => void
```

`AbilityTarget` varies by `TargetType`:

```typescript
export type AbilityTarget =
  | { type: 'direction'; angle: number } // skillshot / dash
  | { type: 'entity'; entityId: string } // targeted
  | { type: 'ground'; x: number; y: number } // aoe_ground
  | { type: 'self' } // self_buff
```

### 3.4 AbilityContext

`AbilityContext` is the interface injected into every ability executor. It exposes a
controlled set of helpers so abilities never touch raw ECS tables directly.

```typescript
export interface AbilityContext {
  // ── Damage ──────────────────────────────────────────────────────────

  /**
   * Deal damage from `source` to `target`.
   * Enters the damage pipeline (see section 4).
   */
  dealDamage(
    source: EntityHandle,
    target: EntityHandle,
    amount: number,
    type: DamageType,
  ): DamageResult

  // ── Projectiles ─────────────────────────────────────────────────────

  /**
   * Spawn a travelling projectile.
   * Returns a handle that can be used to despawn it early.
   */
  spawnProjectile(params: ProjectileParams): ProjectileHandle

  // ── Crowd Control ───────────────────────────────────────────────────

  /** Stun the target for `duration` seconds. */
  applyStun(source: EntityHandle, target: EntityHandle, duration: number): void

  /** Slow the target's movement speed by `percent` (0–1) for `duration` seconds. */
  applySlow(source: EntityHandle, target: EntityHandle, percent: number, duration: number): void

  /** Knock the target back from `source` by `distance` units. */
  applyKnockback(
    source: EntityHandle,
    target: EntityHandle,
    distance: number,
    duration: number,
  ): void

  // ── Movement ────────────────────────────────────────────────────────

  /** Dash the entity toward a point at `speed` units/sec. */
  dash(entity: EntityHandle, toX: number, toY: number, speed: number): void

  /** Instantly teleport the entity to a point (no travel time). */
  blink(entity: EntityHandle, toX: number, toY: number): void

  // ── Buffs ───────────────────────────────────────────────────────────

  /**
   * Apply a buff or debuff. See section 5 for the Buff interface.
   * Returns a handle to remove it early if needed.
   */
  applyBuff(target: EntityHandle, buff: Buff): BuffHandle

  // ── Queries ─────────────────────────────────────────────────────────

  /** Get all entity handles within a circular area. */
  getEntitiesInArea(
    centerX: number,
    centerY: number,
    radius: number,
    filter?: EntityFilter,
  ): EntityHandle[]

  // ── Cooldowns ───────────────────────────────────────────────────────

  /**
   * Reduce all of the entity's ability cooldowns by `seconds`.
   * Used for CDR-on-hit mechanics (e.g. Ezreal Q).
   */
  reduceAllCooldowns(entity: EntityHandle, seconds: number): void

  // ── Scheduling ──────────────────────────────────────────────────────

  /**
   * Schedule a callback to run after `delaySeconds`.
   * Useful for delayed detonations, multi-part abilities, etc.
   */
  after(delaySeconds: number, callback: () => void): void
}
```

Supporting types referenced above:

```typescript
export type DamageType = 'physical' | 'magical' | 'true'

export interface DamageResult {
  /** Raw damage before mitigation. */
  rawDamage: number
  /** Final HP actually lost by the target. */
  finalDamage: number
  /** How much shield was consumed. */
  shieldAbsorbed: number
  /** Whether the target died. */
  killed: boolean
}

export interface ProjectileParams {
  owner: EntityHandle
  startX: number
  startY: number
  angle: number
  speed: number
  range: number
  width: number
  /** If true the projectile continues through targets instead of stopping. */
  piercing: boolean
  onHit: (target: EntityHandle) => void
}

export interface EntityFilter {
  team?: 'ally' | 'enemy' | 'all'
  alive?: boolean
  /** Exclude specific entity. */
  exclude?: EntityHandle
}
```

---

## 4. Damage Pipeline

When `ctx.dealDamage()` is called, the server processes damage through a strict pipeline.
Every step runs in the order listed below. No step may be skipped.

### Pipeline Stages

```
 Raw Damage Calculation
          |
          v
 Damage Type Classification
          |
          v
 Resistance Reduction
          |
          v
 Percentage Damage Reduction
          |
          v
 Shield Absorption
          |
          v
 Final HP Loss
          |
          v
 Post-Damage Triggers
```

### Stage 1 — Raw Damage Calculation

The raw amount is computed by the ability executor before calling `dealDamage`. Typically
this uses `resolveScaling`:

```typescript
const raw = resolveScaling(ability.scaling, rank, casterStats)
```

### Stage 2 — Damage Type Classification

The caller specifies `DamageType`. This determines which resistance stat is applied.

| DamageType | Resisted by   |
| ---------- | ------------- |
| `physical` | `armor`       |
| `magical`  | `magicResist` |
| `true`     | _nothing_     |

### Stage 3 — Resistance Reduction

For physical and magical damage, resistance reduces the incoming value:

```
mitigated = raw * (100 / (100 + resistance))
```

Where `resistance` is the target's effective armor or magic resist (after penetration
calculations). True damage skips this step entirely.

```typescript
function applyResistance(raw: number, resistance: number): number {
  if (resistance >= 0) {
    return raw * (100 / (100 + resistance))
  }
  // Negative resistance amplifies damage.
  return raw * (2 - 100 / (100 - resistance))
}
```

**Resistance can go negative** (via armor shred / reduction debuffs). In that case the
formula above causes the target to take _more_ than raw damage — this is intentional.

### Stage 4 — Percentage Damage Reduction

After resistance, any percentage-based damage reduction modifiers are applied
multiplicatively. Examples: Exhaust (40% reduction), Alistar R (70% reduction).

```typescript
function applyPercentReduction(
  damage: number,
  reductions: number[], // e.g. [0.40, 0.70]
): number {
  for (const r of reductions) {
    damage *= 1 - r
  }
  return damage
}
```

Multiple reductions stack multiplicatively, not additively:

```
Exhaust (40%) + Alistar R (70%) = damage * 0.60 * 0.30 = 18% of post-resistance damage
```

### Stage 5 — Shield Absorption

Shields are consumed before HP. Each shield has a remaining value; damage eats through
shields in the order they were applied (FIFO).

```typescript
function absorbShields(damage: number, shields: Shield[]): { remaining: number; absorbed: number } {
  let absorbed = 0
  for (const shield of shields) {
    if (damage <= 0) break
    const take = Math.min(damage, shield.remaining)
    shield.remaining -= take
    damage -= take
    absorbed += take
  }
  return { remaining: damage, absorbed }
}
```

Magic-only shields (e.g. Hexdrinker) are checked only when `damageType === 'magical'`.
Generic shields absorb all types.

### Stage 6 — Final HP Loss

The remaining damage after shield absorption is subtracted from the target's current HP.

```typescript
target.hp = Math.max(0, target.hp - remaining)
const killed = target.hp === 0
```

### Stage 7 — Post-Damage Triggers

After HP loss is applied, the engine fires events that other systems listen for:

| Trigger            | Description                                            |
| ------------------ | ------------------------------------------------------ |
| **Lifesteal**      | Attacker heals for `finalDamage * lifestealPercent`.   |
| **Spell vamp**     | Same as lifesteal but for ability damage.              |
| **Thorns**         | Target reflects flat damage back to attacker.          |
| **On-hit effects** | Item procs (e.g. Sheen) that occur after damage lands. |
| **Death check**    | If killed, despawn entity and award gold/XP.           |

```typescript
function runPostDamageTriggers(
  source: EntityHandle,
  target: EntityHandle,
  result: DamageResult,
  damageType: DamageType,
): void {
  // Lifesteal (physical auto-attacks only)
  if (damageType === 'physical' && source.stats.lifesteal > 0) {
    const heal = result.finalDamage * source.stats.lifesteal
    source.hp = Math.min(source.hp + heal, source.maxHp)
  }

  // Thorns (e.g. Thornmail buff on target)
  const thornsBuff = target.getBuffById('thorns')
  if (thornsBuff && damageType === 'physical') {
    dealDamage(target, source, thornsBuff.reflectDamage, 'magical')
  }

  // Death
  if (result.killed) {
    onEntityKilled(source, target)
  }
}
```

### Complete Pipeline Function

```typescript
export function processDamage(
  source: EntityHandle,
  target: EntityHandle,
  rawDamage: number,
  damageType: DamageType,
): DamageResult {
  // Stage 1 — raw damage already provided by caller.
  let damage = rawDamage

  // Stage 2+3 — resistance.
  if (damageType === 'physical') {
    damage = applyResistance(damage, target.stats.armor)
  } else if (damageType === 'magical') {
    damage = applyResistance(damage, target.stats.magicResist)
  }
  // true damage: no resistance applied.

  // Stage 4 — percentage reductions from buffs.
  const reductions = target.getPercentReductions()
  damage = applyPercentReduction(damage, reductions)

  // Stage 5 — shields.
  const shields = target.getActiveShields(damageType)
  const { remaining, absorbed } = absorbShields(damage, shields)

  // Stage 6 — HP loss.
  const hpBefore = target.hp
  target.hp = Math.max(0, target.hp - remaining)
  const finalDamage = hpBefore - target.hp
  const killed = target.hp === 0

  const result: DamageResult = {
    rawDamage,
    finalDamage,
    shieldAbsorbed: absorbed,
    killed,
  }

  // Stage 7 — post-damage triggers.
  runPostDamageTriggers(source, target, result, damageType)

  return result
}
```

---

## 5. Buff / Debuff System

Buffs and debuffs share a single `Buff` interface. Whether an effect is positive or
negative is determined by context (a slow is negative; a shield is positive). The engine
treats them identically.

### Buff Interface

```typescript
export type BuffType =
  | 'stun'
  | 'slow'
  | 'silence'
  | 'root'
  | 'shield'
  | 'invulnerable'
  | 'stat_modifier'
  | 'dot' // damage over time
  | 'custom'

export interface Buff {
  /** Unique identifier, e.g. "exhaust_slow", "ezreal_w_mark". */
  id: string

  /** Category — used for interaction rules. */
  type: BuffType

  /** Total duration in seconds. Set to Infinity for permanent buffs. */
  duration: number

  /**
   * Whether multiple instances of this buff can exist on the same target.
   * If false, reapplying refreshes the duration instead.
   */
  stackable: boolean

  /** Maximum number of stacks (only relevant when stackable is true). */
  maxStacks?: number

  /** Whether this buff can be removed by Cleanse / QSS effects. */
  cleansable: boolean

  /**
   * Called once when the buff is first applied.
   * Use for one-time stat changes, VFX spawning, etc.
   */
  onApply?: (target: EntityHandle) => void

  /**
   * Called every server tick while the buff is active.
   * `dt` is the time in seconds since the last tick.
   */
  onTick?: (target: EntityHandle, dt: number) => void

  /**
   * Called when the buff expires or is removed.
   * Use for cleanup: revert stat changes, despawn VFX.
   */
  onRemove?: (target: EntityHandle) => void

  /**
   * Called whenever the buffed entity receives damage (after the pipeline).
   * Allows buffs to modify incoming damage or trigger side effects.
   * Return a modified damage value, or undefined to leave it unchanged.
   */
  onDamageReceived?: (target: EntityHandle, damage: number, type: DamageType) => number | undefined
}
```

### Common Buff Types

| Type            | Behavior                                                       |
| --------------- | -------------------------------------------------------------- |
| `stun`          | Target cannot move, attack, or cast abilities.                 |
| `slow`          | Reduces `moveSpeed` by a percentage.                           |
| `silence`       | Target cannot cast abilities (can still move and auto-attack). |
| `root`          | Target cannot move or dash (can still attack and cast).        |
| `shield`        | Absorbs incoming damage before HP is lost.                     |
| `invulnerable`  | Target takes 0 damage from all sources.                        |
| `stat_modifier` | Adds or subtracts from any `BaseStats` field.                  |
| `dot`           | Deals damage per tick via `onTick`.                            |

### Stacking Rules

```typescript
export function applyBuffToEntity(entity: EntityHandle, buff: Buff): BuffHandle {
  const existing = entity.buffs.filter((b) => b.id === buff.id)

  if (!buff.stackable && existing.length > 0) {
    // Refresh duration of existing instance.
    existing[0].remainingDuration = buff.duration
    return existing[0].handle
  }

  if (buff.stackable && buff.maxStacks && existing.length >= buff.maxStacks) {
    // At max stacks — refresh the oldest instance.
    existing[0].remainingDuration = buff.duration
    return existing[0].handle
  }

  // Add new instance.
  const instance = createBuffInstance(buff)
  entity.buffs.push(instance)
  buff.onApply?.(entity)
  return instance.handle
}
```

### Cleanse Mechanics

Cleanse removes all buffs where `cleansable === true`. Hard CC (stun, root, silence) is
always cleansable. Suppression and knockback are not cleansable.

```typescript
export function cleanse(entity: EntityHandle): void {
  const toRemove = entity.buffs.filter((b) => b.definition.cleansable)
  for (const instance of toRemove) {
    instance.definition.onRemove?.(entity)
  }
  entity.buffs = entity.buffs.filter((b) => !b.definition.cleansable)
}
```

### Buff Tick Loop

On every server tick the engine iterates all active buff instances:

```typescript
export function tickBuffs(entity: EntityHandle, dt: number): void {
  for (let i = entity.buffs.length - 1; i >= 0; i--) {
    const instance = entity.buffs[i]
    instance.remainingDuration -= dt

    if (instance.remainingDuration <= 0) {
      instance.definition.onRemove?.(entity)
      entity.buffs.splice(i, 1)
      continue
    }

    instance.definition.onTick?.(entity, dt)
  }
}
```

---

## 6. Cooldown System

### Tracking Cooldowns

Each champion entity maintains a cooldown timer per ability slot. When an ability is cast,
the timer is set to the ability's cooldown at the current rank. The timer decrements every
tick.

```typescript
export interface CooldownState {
  /** Remaining cooldown per ability slot (Q=0, W=1, E=2, R=3). */
  remaining: [number, number, number, number]
}

export function startCooldown(
  state: CooldownState,
  slot: number,
  baseCooldown: number,
  abilityHaste: number,
): void {
  const effectiveCooldown = baseCooldown * (100 / (100 + abilityHaste))
  state.remaining[slot] = effectiveCooldown
}

export function tickCooldowns(state: CooldownState, dt: number): void {
  for (let i = 0; i < 4; i++) {
    state.remaining[i] = Math.max(0, state.remaining[i] - dt)
  }
}

export function isReady(state: CooldownState, slot: number): boolean {
  return state.remaining[slot] <= 0
}
```

### Ability Haste vs. Cooldown Reduction

The game uses **Ability Haste** (AH) rather than percentage-based CDR. Ability Haste
scales linearly — every point of AH gives the same marginal benefit.

```
effective cooldown = base cooldown * (100 / (100 + AH))
```

| AH  | Effective CDR |
| --- | ------------- |
| 0   | 0%            |
| 10  | 9.1%          |
| 20  | 16.7%         |
| 40  | 28.6%         |
| 60  | 37.5%         |
| 80  | 44.4%         |
| 100 | 50.0%         |
| 150 | 60.0%         |

There is no hard cap on AH. The diminishing-return nature of the formula prevents
cooldowns from ever reaching zero.

### Flat Cooldown Reduction (On-Hit)

Some abilities (e.g. Ezreal Q) reduce all cooldowns by a flat amount on hit. This uses
`ctx.reduceAllCooldowns`:

```typescript
export function reduceAllCooldowns(state: CooldownState, seconds: number): void {
  for (let i = 0; i < 4; i++) {
    state.remaining[i] = Math.max(0, state.remaining[i] - seconds)
  }
}
```

---

## 7. Example Champion

Below is a complete champion definition for **Aethershot** — an Ezreal-like marksman with
a skillshot Q that reduces cooldowns on hit, a pass-through W, a blink + auto-target E,
and a global ultimate R.

```typescript
import type {
  ChampionDefinition,
  AbilityDefinition,
  AbilityContext,
  EntityHandle,
  AbilityTarget,
} from '@league/shared'

// ─── Base Stats ──────────────────────────────────────────────────────────────

const baseStats = {
  hp: 600,
  mp: 375,
  ad: 60,
  ap: 0,
  armor: 24,
  magicResist: 30,
  attackSpeed: 0.625,
  moveSpeed: 325,
  attackRange: 550,
  hpRegen: 4.0,
  mpRegen: 8.5,
  critChance: 0,
} as const

const statsPerLevel = {
  hp: 102,
  mp: 50,
  ad: 2.75,
  armor: 4.5,
  magicResist: 1.3,
  attackSpeed: 0.015,
  hpRegen: 0.55,
  mpRegen: 0.8,
} as const

// ─── Q — Arcane Bolt ─────────────────────────────────────────────────────────
// A skillshot projectile. On hit, reduces all cooldowns by 1.5 seconds.

const abilityQ: AbilityDefinition = {
  id: 'aethershot_q',
  name: 'Arcane Bolt',
  key: 'Q',
  cooldown: [5.5, 5.25, 5.0, 4.75, 4.5],
  manaCost: [28, 31, 34, 37, 40],
  range: 1150,
  targetType: 'skillshot',
  scaling: {
    base: [20, 45, 70, 95, 120],
    adRatio: 1.3,
    apRatio: 0.15,
  },
  execute(ctx: AbilityContext, caster: EntityHandle, target: AbilityTarget, rank: number) {
    if (target.type !== 'direction') return

    const casterPos = ctx.getPosition(caster)
    const damage = ctx.resolveScaling(this.scaling, rank, caster)

    ctx.spawnProjectile({
      owner: caster,
      startX: casterPos.x,
      startY: casterPos.y,
      angle: target.angle,
      speed: 2000,
      range: 1150,
      width: 60,
      piercing: false,
      onHit(hit: EntityHandle) {
        ctx.dealDamage(caster, hit, damage, 'physical')
        // Core mechanic: hitting Q reduces all cooldowns by 1.5s.
        ctx.reduceAllCooldowns(caster, 1.5)
      },
    })
  },
}

// ─── W — Essence Flux ────────────────────────────────────────────────────────
// A pass-through skillshot that marks enemies and allies. If the caster hits a
// marked target with another ability or auto-attack, the mark detonates for
// bonus magic damage.

const W_MARK_DURATION = 4 // seconds

const abilityW: AbilityDefinition = {
  id: 'aethershot_w',
  name: 'Essence Flux',
  key: 'W',
  cooldown: [12, 12, 12, 12, 12],
  manaCost: [50, 50, 50, 50, 50],
  range: 1150,
  targetType: 'skillshot',
  scaling: {
    base: [80, 135, 190, 245, 300],
    adRatio: 0.6,
    apRatio: 0.7,
  },
  execute(ctx: AbilityContext, caster: EntityHandle, target: AbilityTarget, rank: number) {
    if (target.type !== 'direction') return

    const casterPos = ctx.getPosition(caster)
    const detonationDamage = ctx.resolveScaling(this.scaling, rank, caster)

    ctx.spawnProjectile({
      owner: caster,
      startX: casterPos.x,
      startY: casterPos.y,
      angle: target.angle,
      speed: 1600,
      range: 1150,
      width: 80,
      piercing: true, // passes through all targets
      onHit(hit: EntityHandle) {
        // Apply the W mark as a buff. Detonation happens on next ability/auto hit.
        ctx.applyBuff(hit, {
          id: 'aethershot_w_mark',
          type: 'custom',
          duration: W_MARK_DURATION,
          stackable: false,
          cleansable: false,
          onDamageReceived(entity, damage, type) {
            // Detonate when the caster damages this target with any other source.
            // The onDamageReceived hook fires after the initial damage lands.
            ctx.dealDamage(caster, entity, detonationDamage, 'magical')
            // Remove the mark after detonation (one-time trigger).
            ctx.removeBuff(entity, 'aethershot_w_mark')
            return undefined // do not modify the triggering damage
          },
        })
      },
    })
  },
}

// ─── E — Phase Shift ─────────────────────────────────────────────────────────
// Blink to cursor location, then fire a homing bolt at the nearest enemy.

const abilityE: AbilityDefinition = {
  id: 'aethershot_e',
  name: 'Phase Shift',
  key: 'E',
  cooldown: [13, 11.5, 10, 8.5, 7],
  manaCost: [90, 90, 90, 90, 90],
  range: 475,
  targetType: 'dash',
  scaling: {
    base: [80, 130, 180, 230, 280],
    adRatio: 0.5,
    apRatio: 0.75,
  },
  execute(ctx: AbilityContext, caster: EntityHandle, target: AbilityTarget, rank: number) {
    if (target.type !== 'direction') return

    const casterPos = ctx.getPosition(caster)
    const blinkDistance = 475
    const destX = casterPos.x + Math.cos(target.angle) * blinkDistance
    const destY = casterPos.y + Math.sin(target.angle) * blinkDistance

    // Instant blink.
    ctx.blink(caster, destX, destY)

    // After blinking, auto-target the nearest enemy and fire a homing bolt.
    const nearby = ctx.getEntitiesInArea(destX, destY, 750, {
      team: 'enemy',
      alive: true,
    })

    if (nearby.length > 0) {
      // Pick the closest enemy.
      const closestEnemy = nearby[0]
      const damage = ctx.resolveScaling(this.scaling, rank, caster)
      ctx.dealDamage(caster, closestEnemy, damage, 'magical')
    }
  },
}

// ─── R — Trueshot Barrage ────────────────────────────────────────────────────
// Fires a massive global-range projectile that damages all enemies it passes
// through. Damage is reduced by 10% per target hit (minimum 30% damage).

const abilityR: AbilityDefinition = {
  id: 'aethershot_r',
  name: 'Trueshot Barrage',
  key: 'R',
  cooldown: [120, 105, 90],
  manaCost: [100, 100, 100],
  range: 0, // global
  targetType: 'skillshot',
  scaling: {
    base: [350, 500, 650],
    adRatio: 1.0,
    apRatio: 0.9,
  },
  execute(ctx: AbilityContext, caster: EntityHandle, target: AbilityTarget, rank: number) {
    if (target.type !== 'direction') return

    const casterPos = ctx.getPosition(caster)
    const baseDamage = ctx.resolveScaling(this.scaling, rank, caster)
    let hitCount = 0

    ctx.spawnProjectile({
      owner: caster,
      startX: casterPos.x,
      startY: casterPos.y,
      angle: target.angle,
      speed: 2000,
      range: 20000, // effectively global on an ARAM map
      width: 160,
      piercing: true,
      onHit(hit: EntityHandle) {
        // Damage falloff: -10% per target hit, min 30%.
        const falloff = Math.max(0.3, 1.0 - hitCount * 0.1)
        const damage = baseDamage * falloff
        ctx.dealDamage(caster, hit, damage, 'magical')
        hitCount++
      },
    })
  },
}

// ─── Full Champion Definition ────────────────────────────────────────────────

export const Aethershot: ChampionDefinition = {
  id: 'aethershot',
  name: 'Aethershot',
  baseStats: { ...baseStats },
  statsPerLevel: { ...statsPerLevel },
  abilities: [abilityQ, abilityW, abilityE, abilityR],
}
```

### Stat Progression at Key Levels

| Level | HP   | AD    | Armor | MR   | AS    |
| ----- | ---- | ----- | ----- | ---- | ----- |
| 1     | 600  | 60.00 | 24.0  | 30.0 | 0.625 |
| 6     | 1110 | 73.75 | 46.5  | 36.5 | 0.700 |
| 11    | 1620 | 87.50 | 69.0  | 43.0 | 0.775 |
| 16    | 2130 | 101.3 | 91.5  | 49.5 | 0.850 |
| 18    | 2334 | 106.8 | 100.5 | 52.1 | 0.880 |

---

## 8. Champion Registry

Champions are registered at startup into a simple `Map`. Both server and client import
the registry from the shared package to look up definitions by id.

```typescript
const registry = new Map<string, ChampionDefinition>()

/**
 * Register a champion definition. Called once per champion at boot.
 * Throws if a duplicate id is registered.
 */
export function registerChampion(definition: ChampionDefinition): void {
  if (registry.has(definition.id)) {
    throw new Error(`Champion "${definition.id}" is already registered.`)
  }
  registry.set(definition.id, definition)
}

/**
 * Look up a champion by id. Returns undefined if not found.
 */
export function getChampion(id: string): ChampionDefinition | undefined {
  return registry.get(id)
}

/**
 * Get all registered champion definitions (for champion select UI, etc.).
 */
export function getAllChampions(): ChampionDefinition[] {
  return Array.from(registry.values())
}

/**
 * Get the total count of registered champions.
 */
export function getChampionCount(): number {
  return registry.size
}
```

### Boot-time Registration

Each champion file exports its definition. A barrel file imports them all and registers
them in one pass:

```typescript
// packages/shared/src/champions/index.ts

import { registerChampion } from './registry'
import { Aethershot } from './aethershot'
import { Frostbow } from './frostbow'
import { Ironguard } from './ironguard'
// ... all other champions

const ALL_CHAMPIONS: ChampionDefinition[] = [
  Aethershot,
  Frostbow,
  Ironguard,
  // ...
]

for (const champ of ALL_CHAMPIONS) {
  registerChampion(champ)
}

export { getChampion, getAllChampions, getChampionCount } from './registry'
```

---

## 9. File Structure

Champion-related code is distributed across three packages in the monorepo. The shared
package contains all data that both client and server need. Server-specific execution
logic lives in the API app. Client-specific rendering and prediction code lives in the
web app.

```
packages/
  shared/
    src/
      champions/
        index.ts              # barrel — registers all champions, re-exports registry
        registry.ts           # Map<string, ChampionDefinition>, register/get functions
        types.ts              # ChampionDefinition, BaseStats, StatsPerLevel, AbilityDefinition,
                              #   AbilityContext, Buff, ScalingValue, DamageType, etc.
        stats.ts              # getStatsAtLevel, applyItemBonuses, applyPercentModifiers
        scaling.ts            # resolveScaling helper
        aethershot.ts         # Aethershot champion definition
        frostbow.ts           # (another champion)
        ironguard.ts          # (another champion)
        ...                   # one file per champion

apps/
  api/
    src/
      modules/
        game/
          ability-executor.ts # server-authoritative ability execution loop
          damage-pipeline.ts  # processDamage — full 7-stage pipeline
          buff-manager.ts     # applyBuffToEntity, tickBuffs, cleanse
          cooldown-manager.ts # startCooldown, tickCooldowns, reduceAllCooldowns
          projectile-sim.ts   # projectile movement, collision detection
          context-factory.ts  # builds the AbilityContext injected into executors

  web/
    src/
      game/
        champion-display.ts   # renders champion model, animations, VFX
        ability-input.ts      # keyboard/mouse → AbilityTarget conversion
        cooldown-hud.ts       # UI overlay showing remaining cooldowns
        buff-indicators.ts    # status icons above health bar
        client-prediction.ts  # optimistic ability casts, reconciled on server ack
        stat-panel.ts         # character stats panel in the HUD
```

### Dependency Flow

```
  apps/web  ──imports──>  packages/shared  <──imports──  apps/api
   (client)                (definitions,                  (server)
                            types, stats)
```

- `packages/shared` has **zero** runtime dependencies on either app.
- `apps/api` imports shared types and definitions, then wraps them in server-only logic
  (authoritative simulation, persistence, anti-cheat).
- `apps/web` imports shared types for display, input handling, and client-side prediction.
  It never runs ability executors — those are server-only.

### Adding a New Champion

1. Create `packages/shared/src/champions/<champion_id>.ts`.
2. Define the `ChampionDefinition` with base stats, per-level growth, and four abilities.
3. Import and add it to the `ALL_CHAMPIONS` array in `packages/shared/src/champions/index.ts`.
4. The champion is now available in the registry for both server and client.
5. Add any champion-specific VFX / animations to `apps/web/src/game/`.

No server restart is needed during development if using hot-reload — the shared package
is watched by both apps.
