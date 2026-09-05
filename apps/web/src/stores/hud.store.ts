import { create } from 'zustand'
import { DefaultChampion, getChampionDefinition, CHAMPION_CATALOG } from '@template-dev/shared'
import type { BaseStats } from '@template-dev/shared'

import type { AbilitySlot } from './game-settings.store'

export const ABILITY_SLOT_LABELS: Record<AbilitySlot, string> = {
  0: 'Q',
  1: 'W',
  2: 'E',
  3: 'R',
}

/** Placeholder cooldowns per slot (seconds) */
export const PLACEHOLDER_COOLDOWNS: Record<AbilitySlot, number> = { 0: 6, 1: 10, 2: 14, 3: 80 }
/** Placeholder mana costs per slot */
export const PLACEHOLDER_MANA_COSTS: Record<AbilitySlot, number> = { 0: 50, 1: 60, 2: 70, 3: 100 }

export interface AbilityState {
  cooldownRemaining: number
  cooldownTotal: number
  rank: number
  casting: boolean
}

function createDefaultAbility(): AbilityState {
  return { cooldownRemaining: 0, cooldownTotal: 0, rank: 1, casting: false }
}

const CDRAGON_BASE =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default'

/** Convert a CommunityDragon asset path to a full URL. */
function cdnUrl(assetPath: string): string {
  // "/lol-game-data/assets/ASSETS/Characters/Ahri/..." → "characters/ahri/..."
  const relative = assetPath.replace(/^\/lol-game-data\/assets\/ASSETS\//i, '').toLowerCase()
  return `${CDRAGON_BASE}/assets/${relative}`
}

/** Fetch ability icon URLs (Q, W, E, R) for a champion from CommunityDragon. */
async function fetchAbilityIcons(championId: number): Promise<[string, string, string, string]> {
  try {
    const res = await fetch(`${CDRAGON_BASE}/v1/champions/${championId}.json`)
    if (!res.ok) return ['', '', '', '']
    const data = await res.json()
    const spells: { abilityIconPath?: string }[] = data.spells ?? []
    return [
      spells[0]?.abilityIconPath ? cdnUrl(spells[0].abilityIconPath) : '',
      spells[1]?.abilityIconPath ? cdnUrl(spells[1].abilityIconPath) : '',
      spells[2]?.abilityIconPath ? cdnUrl(spells[2].abilityIconPath) : '',
      spells[3]?.abilityIconPath ? cdnUrl(spells[3].abilityIconPath) : '',
    ]
  } catch {
    return ['', '', '', '']
  }
}

interface HudState {
  currentHp: number
  maxHp: number
  currentMp: number
  maxMp: number
  level: number
  xp: number
  xpToNextLevel: number
  stats: BaseStats

  abilities: [AbilityState, AbilityState, AbilityState, AbilityState]
  /** Ability icon URLs [Q, W, E, R] — empty string if not loaded */
  abilityIcons: [string, string, string, string]

  championId: number
  championName: string

  tick: (dt: number) => void
  castAbility: (slot: AbilitySlot) => boolean
  initChampion: (championAlias: string) => void
  updateFromSnapshot: (data: {
    hp: number
    maxHp: number
    mp: number
    maxMp: number
    level: number
    xp: number
    xpToNextLevel: number
    championType: string
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
  }) => void
  reset: () => void
}

const defaultStats = { ...DefaultChampion.baseStats }

export const useHudStore = create<HudState>()((set, get) => ({
  currentHp: defaultStats.hp,
  maxHp: defaultStats.hp,
  currentMp: defaultStats.mp,
  maxMp: defaultStats.mp,
  level: 1,
  xp: 0,
  xpToNextLevel: 280,
  stats: defaultStats,

  abilities: [
    createDefaultAbility(),
    createDefaultAbility(),
    createDefaultAbility(),
    createDefaultAbility(),
  ],
  abilityIcons: ['', '', '', ''],
  championId: 0,
  championName: 'Champion',

  tick: (dt) => {
    const state = get()
    let changed = false
    const abilities = [...state.abilities] as [
      AbilityState,
      AbilityState,
      AbilityState,
      AbilityState,
    ]
    for (let i = 0; i < 4; i++) {
      if (abilities[i].cooldownRemaining > 0) {
        abilities[i] = {
          ...abilities[i],
          cooldownRemaining: Math.max(0, abilities[i].cooldownRemaining - dt),
        }
        changed = true
      }
    }
    if (changed) set({ abilities })
  },

  castAbility: (slot) => {
    const state = get()
    const ability = state.abilities[slot]
    if (ability.cooldownRemaining > 0 || ability.rank === 0) return false

    const manaCost = PLACEHOLDER_MANA_COSTS[slot]
    if (state.currentMp < manaCost) return false

    const cd = PLACEHOLDER_COOLDOWNS[slot]
    const abilities = [...state.abilities] as [
      AbilityState,
      AbilityState,
      AbilityState,
      AbilityState,
    ]
    abilities[slot] = {
      ...ability,
      cooldownRemaining: cd,
      cooldownTotal: cd,
      casting: true,
    }

    set({
      abilities,
      currentMp: Math.max(0, state.currentMp - manaCost),
    })
    return true
  },

  initChampion: (championAlias) => {
    const catalog = CHAMPION_CATALOG[championAlias]
    const def = getChampionDefinition(championAlias)
    if (!catalog || !def) return

    const stats = def.baseStats
    set({
      championId: catalog.id,
      championName: def.name,
      currentHp: stats.hp,
      maxHp: stats.hp,
      currentMp: stats.mp,
      maxMp: stats.mp,
      stats: { ...stats },
      abilityIcons: ['', '', '', ''],
    })

    // Fetch ability icons from CommunityDragon (async, non-blocking)
    fetchAbilityIcons(catalog.id).then((icons) => {
      // Only apply if still the same champion
      if (get().championId === catalog.id) {
        set({ abilityIcons: icons })
      }
    })
  },

  updateFromSnapshot: (data) => {
    const state = get()

    // Update champion identity from server if it changed
    let championId = state.championId
    let championName = state.championName
    if (data.championType && data.championType !== 'default') {
      const def = getChampionDefinition(data.championType)
      if (def && def.name !== state.championName) {
        championName = def.name
        const catalog = CHAMPION_CATALOG[data.championType]
        if (catalog) championId = catalog.id
      }
    }

    set({
      currentHp: data.hp,
      maxHp: data.maxHp,
      currentMp: data.mp,
      maxMp: data.maxMp,
      level: data.level,
      xp: data.xp,
      xpToNextLevel: data.xpToNextLevel,
      championId,
      championName,
      stats: {
        ...state.stats,
        ad: data.ad,
        ap: data.ap,
        armor: data.armor,
        magicResist: data.magicResist,
        attackSpeed: data.attackSpeed,
        moveSpeed: data.moveSpeed,
        attackRange: data.attackRange,
        hpRegen: data.hpRegen,
        mpRegen: data.mpRegen,
        critChance: data.critChance,
      },
    })
  },

  reset: () => {
    set({
      currentHp: defaultStats.hp,
      maxHp: defaultStats.hp,
      currentMp: defaultStats.mp,
      maxMp: defaultStats.mp,
      level: 1,
      xp: 0,
      xpToNextLevel: 280,
      stats: { ...defaultStats },
      abilities: [
        createDefaultAbility(),
        createDefaultAbility(),
        createDefaultAbility(),
        createDefaultAbility(),
      ],
      abilityIcons: ['', '', '', ''],
      championId: 0,
      championName: 'Champion',
    })
  },
}))
