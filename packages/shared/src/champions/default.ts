import type { ChampionDefinition } from '../game/combat'

/** Default champion used in Phase 3 (melee, balanced stats). */
export const DefaultChampion: ChampionDefinition = {
  id: 'default',
  name: 'Champion',
  baseStats: {
    hp: 600,
    mp: 400,
    ad: 60,
    ap: 0,
    armor: 30,
    magicResist: 32,
    attackSpeed: 0.625,
    moveSpeed: 325,
    attackRange: 125,
    hpRegen: 8,
    mpRegen: 7,
    critChance: 0,
  },
  statsPerLevel: {
    hp: 102,
    mp: 50,
    ad: 3.5,
    armor: 4.5,
    magicResist: 1.3,
    attackSpeed: 0.015,
    hpRegen: 0.5,
    mpRegen: 0.5,
  },
  baseWindupPercent: 0.3,
  isMelee: true,
  projectileSpeed: 0,
}
