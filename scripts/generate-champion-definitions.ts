#!/usr/bin/env bun
/**
 * Generate champion definitions (stats) from DDragon + CommunityDragon APIs.
 *
 * DDragon provides:   base stats, stats per level, attack range
 * CommunityDragon:    windup percent, projectile speed, melee/ranged
 *
 * Usage:
 *   bun run scripts/generate-champion-definitions.ts
 *
 * Output:
 *   packages/shared/src/champions/definitions.ts
 */

import { join } from 'path'

// --- Config ---

const OUTPUT_FILE = join(
  import.meta.dir,
  '..',
  'packages',
  'shared',
  'src',
  'champions',
  'definitions.ts',
)

const DDRAGON_VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json'
const CDRAGON_CHAR_BASE = 'https://raw.communitydragon.org/latest/game/data/characters'
const CDRAGON_SUMMARY =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json'

// --- Types ---

interface DDragonStats {
  hp: number
  hpperlevel: number
  mp: number
  mpperlevel: number
  movespeed: number
  armor: number
  armorperlevel: number
  spellblock: number
  spellblockperlevel: number
  attackrange: number
  hpregen: number
  hpregenperlevel: number
  mpregen: number
  mpregenperlevel: number
  crit: number
  critperlevel: number
  attackdamage: number
  attackdamageperlevel: number
  attackspeed: number
  attackspeedperlevel: number
}

interface DDragonChampion {
  id: string
  key: string
  name: string
  stats: DDragonStats
}

interface CDragonSummaryEntry {
  id: number
  name: string
  alias: string
}

interface GeneratedChampion {
  id: string
  name: string
  baseStats: {
    hp: number
    mp: number
    ad: number
    ap: number
    armor: number
    magicResist: number
    attackSpeed: number
    moveSpeed: number
    attackRange: number
    hpRegen: number
    mpRegen: number
    critChance: number
  }
  statsPerLevel: Record<string, number>
  baseWindupPercent: number
  isMelee: boolean
  projectileSpeed: number
}

// --- Helpers ---

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.json()
}

async function pooled<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let index = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const i = index++
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
}

/**
 * Parse CommunityDragon character .bin.json to extract:
 *  - mAttackDelayCastOffsetPercent (windup modifier)
 *  - missileSpeed (basic attack projectile speed)
 */
async function fetchCDragonCharData(
  alias: string,
): Promise<{ windupOffset: number; missileSpeed: number } | null> {
  const url = `${CDRAGON_CHAR_BASE}/${alias.toLowerCase()}/${alias.toLowerCase()}.bin.json`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const text = await res.text()

    // Extract windup offset from the bin data
    let windupOffset = 0
    const windupMatch = text.match(/"mAttackDelayCastOffsetPercent"\s*:\s*([-\d.]+)/)
    if (windupMatch) {
      windupOffset = parseFloat(windupMatch[1])
    }

    // Extract basic attack missile speed
    let missileSpeed = 0
    // Look for basic attack missile speed in the character record
    const missileMatches = text.match(/"missileSpeed"\s*:\s*([\d.]+)/g)
    if (missileMatches && missileMatches.length > 0) {
      // First match is typically the basic attack projectile
      const val = parseFloat(missileMatches[0].split(':')[1])
      if (!isNaN(val)) missileSpeed = val
    }

    return { windupOffset, missileSpeed }
  } catch {
    return null
  }
}

function round(n: number, decimals = 4): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals
}

// --- Main ---

async function main() {
  // 1. Get latest DDragon version
  console.log('Fetching latest DDragon version...')
  const versions = await fetchJSON<string[]>(DDRAGON_VERSIONS_URL)
  const latestVersion = versions[0]
  console.log(`  Latest version: ${latestVersion}\n`)

  // 2. Fetch all champion stats from DDragon
  const ddragonUrl = `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`
  console.log('Fetching champion data from DDragon...')
  const ddragonData = await fetchJSON<{ data: Record<string, DDragonChampion> }>(ddragonUrl)
  const ddragonChampions = Object.values(ddragonData.data)
  console.log(`  ${ddragonChampions.length} champions loaded\n`)

  // 3. Fetch champion summary from CommunityDragon (for alias mapping)
  console.log('Fetching champion summary from CommunityDragon...')
  const cdSummary = await fetchJSON<CDragonSummaryEntry[]>(CDRAGON_SUMMARY)
  // Build alias lookup: DDragon ID → lowercase alias
  const aliasById: Record<string, string> = {}
  for (const entry of cdSummary) {
    if (entry.id > 0) {
      aliasById[String(entry.id)] = entry.alias.toLowerCase()
    }
  }

  // 4. Fetch windup and projectile data from CommunityDragon (per champion)
  console.log('Fetching windup/projectile data from CommunityDragon...')
  const cdData = new Map<string, { windupOffset: number; missileSpeed: number }>()

  await pooled(ddragonChampions, 10, async (champ, i) => {
    const alias = aliasById[champ.key] ?? champ.id.toLowerCase()
    const data = await fetchCDragonCharData(alias)
    if (data) {
      cdData.set(champ.key, data)
    }
    if ((i + 1) % 20 === 0) {
      console.log(`  ${i + 1}/${ddragonChampions.length} processed...`)
    }
  })

  console.log(`  ${cdData.size} champions with CommunityDragon data\n`)

  // 5. Build definitions
  console.log('Building champion definitions...')
  const champions: GeneratedChampion[] = []

  for (const champ of ddragonChampions) {
    const s = champ.stats
    const alias = aliasById[champ.key] ?? champ.id.toLowerCase()

    // Melee vs ranged: LoL convention is melee < 350 range
    const isMelee = s.attackrange < 350

    // Windup: DDragon doesn't have this directly.
    // CommunityDragon provides mAttackDelayCastOffsetPercent (offset from default ~0.3).
    // Base windup percent = 0.3 + offset (clamped to [0.1, 0.8])
    const cd = cdData.get(champ.key)
    let baseWindupPercent = 0.3 // default
    if (cd) {
      baseWindupPercent = Math.max(0.1, Math.min(0.8, 0.3 + cd.windupOffset))
    }

    // Projectile speed: 0 for melee, from CommunityDragon for ranged
    let projectileSpeed = 0
    if (!isMelee && cd?.missileSpeed) {
      projectileSpeed = cd.missileSpeed
    }

    // Build stats per level (only non-zero values)
    const statsPerLevel: Record<string, number> = {}
    if (s.hpperlevel) statsPerLevel.hp = s.hpperlevel
    if (s.mpperlevel) statsPerLevel.mp = s.mpperlevel
    if (s.attackdamageperlevel) statsPerLevel.ad = s.attackdamageperlevel
    if (s.armorperlevel) statsPerLevel.armor = s.armorperlevel
    if (s.spellblockperlevel) statsPerLevel.magicResist = s.spellblockperlevel
    if (s.attackspeedperlevel) statsPerLevel.attackSpeed = round(s.attackspeedperlevel / 100, 4)
    if (s.hpregenperlevel) statsPerLevel.hpRegen = s.hpregenperlevel
    if (s.mpregenperlevel) statsPerLevel.mpRegen = s.mpregenperlevel

    champions.push({
      id: alias,
      name: champ.name,
      baseStats: {
        hp: s.hp,
        mp: s.mp,
        ad: s.attackdamage,
        ap: 0,
        armor: s.armor,
        magicResist: s.spellblock,
        attackSpeed: s.attackspeed,
        moveSpeed: s.movespeed,
        attackRange: s.attackrange,
        hpRegen: s.hpregen,
        mpRegen: s.mpregen,
        critChance: s.crit,
      },
      statsPerLevel,
      baseWindupPercent: round(baseWindupPercent, 3),
      isMelee,
      projectileSpeed,
    })
  }

  // Sort alphabetically by id
  champions.sort((a, b) => a.id.localeCompare(b.id))

  console.log(`  ${champions.length} champion definitions built\n`)

  // 6. Generate TypeScript
  console.log('Generating TypeScript file...')
  const lines: string[] = []
  lines.push('// Auto-generated by scripts/generate-champion-definitions.ts')
  lines.push('// Do not edit manually.')
  lines.push('//')
  lines.push(`// Generated from DDragon v${latestVersion} + CommunityDragon`)
  lines.push(`// ${champions.length} champions | ${new Date().toISOString().slice(0, 10)}`)
  lines.push('')
  lines.push("import type { ChampionDefinition } from '../game/combat'")
  lines.push('')
  lines.push('export const CHAMPION_DEFINITIONS: Record<string, ChampionDefinition> = {')

  for (const champ of champions) {
    const bs = champ.baseStats
    const spl = champ.statsPerLevel

    // Format statsPerLevel object
    const splEntries = Object.entries(spl)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')

    lines.push(`  ${JSON.stringify(champ.id)}: {`)
    lines.push(`    id: ${JSON.stringify(champ.id)},`)
    lines.push(`    name: ${JSON.stringify(champ.name)},`)
    lines.push(`    baseStats: {`)
    lines.push(`      hp: ${bs.hp}, mp: ${bs.mp}, ad: ${bs.ad}, ap: ${bs.ap},`)
    lines.push(
      `      armor: ${bs.armor}, magicResist: ${bs.magicResist}, attackSpeed: ${bs.attackSpeed},`,
    )
    lines.push(`      moveSpeed: ${bs.moveSpeed}, attackRange: ${bs.attackRange},`)
    lines.push(
      `      hpRegen: ${bs.hpRegen}, mpRegen: ${bs.mpRegen}, critChance: ${bs.critChance},`,
    )
    lines.push(`    },`)
    lines.push(`    statsPerLevel: { ${splEntries} },`)
    lines.push(`    baseWindupPercent: ${champ.baseWindupPercent},`)
    lines.push(`    isMelee: ${champ.isMelee},`)
    lines.push(`    projectileSpeed: ${champ.projectileSpeed},`)
    lines.push(`  },`)
  }

  lines.push('}')
  lines.push('')
  lines.push(
    '/** Get a champion definition by alias. Falls back to DefaultChampion import if not found. */',
  )
  lines.push(
    'export function getChampionDefinition(alias: string): ChampionDefinition | undefined {',
  )
  lines.push('  return CHAMPION_DEFINITIONS[alias]')
  lines.push('}')
  lines.push('')
  lines.push('/** List of all champion aliases that have definitions */')
  lines.push('export const DEFINED_CHAMPION_LIST: string[] = Object.keys(CHAMPION_DEFINITIONS)')
  lines.push('')

  await Bun.write(OUTPUT_FILE, lines.join('\n'))

  console.log(`\nWrote ${OUTPUT_FILE}`)
  console.log(`  ${champions.length} champion definitions generated`)

  // Stats summary
  const meleeCount = champions.filter((c) => c.isMelee).length
  const rangedCount = champions.length - meleeCount
  console.log(`  ${meleeCount} melee, ${rangedCount} ranged`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
