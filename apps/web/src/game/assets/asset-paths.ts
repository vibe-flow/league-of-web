// ===========================================================================
// Centralized asset keys & paths for non-champion GLB models
// ===========================================================================

export interface AssetDef {
  key: string
  path: string
}

// Map terrain
export const ASSET_MAP_HA: AssetDef = {
  key: 'map_ha',
  path: '/lol-assets/maps/howling_abyss.glb',
}

// Structures
export const ASSET_TURRET: AssetDef = {
  key: 'turret',
  path: '/lol-assets/extras/structures/turret.glb',
}

export const ASSET_NEXUS: AssetDef = {
  key: 'nexus',
  path: '/lol-assets/extras/structures/nexus.glb',
}

export const ASSET_INHIBITOR: AssetDef = {
  key: 'inhibitor',
  path: '/lol-assets/extras/structures/inhibitor.glb',
}

export const ASSET_DESTROYED_TOWER: AssetDef = {
  key: 'destroyed_tower',
  path: '/lol-assets/extras/structures/destroyedtower.glb',
}

// Howling Abyss extras
export const ASSET_PORO: AssetDef = {
  key: 'poro',
  path: '/lol-assets/extras/howling_abyss/ha_ap_poro_small.glb',
}

export const ASSET_HEALTH_RELIC: AssetDef = {
  key: 'health_relic',
  path: '/lol-assets/extras/howling_abyss/ha_ap_healthrelic.glb',
}

export const ASSET_BANNER: AssetDef = {
  key: 'banner',
  path: '/lol-assets/extras/howling_abyss/ha_ap_bannermidbridge.glb',
}

export const ASSET_HERMIT: AssetDef = {
  key: 'hermit',
  path: '/lol-assets/extras/howling_abyss/ha_ap_hermit.glb',
}

export const ASSET_VIKING: AssetDef = {
  key: 'viking',
  path: '/lol-assets/extras/howling_abyss/ha_ap_viking.glb',
}

// Asset groups for loading phases
export const CRITICAL_ASSETS = [ASSET_TURRET, ASSET_NEXUS]
export const OPTIONAL_ASSETS = [ASSET_PORO, ASSET_HEALTH_RELIC, ASSET_BANNER]
