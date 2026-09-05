#!/usr/bin/env bun
/**
 * Download all League of Legends 3D assets (GLB) from modelviewer.lol CDN
 *
 * Usage:
 *   bun run scripts/download-lol-assets.ts                    # Download all champions (lite)
 *   bun run scripts/download-lol-assets.ts --quality full     # Download full quality
 *   bun run scripts/download-lol-assets.ts --champion ahri    # Download only Ahri
 *   bun run scripts/download-lol-assets.ts --extras           # Download extras (towers, minions, etc.)
 *   bun run scripts/download-lol-assets.ts --list             # List all champions
 *   bun run scripts/download-lol-assets.ts --concurrency 5    # Max parallel downloads (default: 3)
 *   bun run scripts/download-lol-assets.ts --force            # Re-download even if file exists
 */

import { mkdir, exists } from 'fs/promises'
import { join } from 'path'

// --- Config ---

const CDN_BASE = 'https://cdn.modelviewer.lol/lol'
const CDRAGON_BASE =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1'
const OUTPUT_DIR = join(import.meta.dir, '..', 'assets', 'lol')

// --- Types ---

interface ChampionSummary {
  id: number
  name: string
  alias: string
  roles: string[]
}

interface ChampionData {
  id: number
  name: string
  alias: string
  skins: { id: number; name: string; isBase: boolean }[]
}

interface DownloadResult {
  path: string
  success: boolean
  size?: number
  error?: string
}

// --- Args ---

const args = process.argv.slice(2)
const flags = {
  quality: getFlag('--quality', 'lite') as 'lite' | 'full',
  champion: getFlag('--champion', ''),
  extras: args.includes('--extras'),
  includeTft: args.includes('--include-tft'),
  list: args.includes('--list'),
  concurrency: parseInt(getFlag('--concurrency', '3')),
  skinsOnly: args.includes('--skins-only'),
  baseOnly: args.includes('--base-only'),
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
}

function getFlag(name: string, defaultValue: string): string {
  const index = args.indexOf(name)
  if (index === -1) return defaultValue
  return args[index + 1] ?? defaultValue
}

// --- Helpers ---

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.json()
}

async function downloadFile(
  url: string,
  outputPath: string,
  force = false,
): Promise<DownloadResult> {
  try {
    // Skip if already exists (unless --force)
    if (!force && (await exists(outputPath))) {
      const file = Bun.file(outputPath)
      return { path: outputPath, success: true, size: file.size }
    }

    const res = await fetch(url)
    if (!res.ok) {
      return { path: outputPath, success: false, error: `HTTP ${res.status}` }
    }

    const buffer = await res.arrayBuffer()
    await mkdir(join(outputPath, '..'), { recursive: true })
    await Bun.write(outputPath, buffer)

    return { path: outputPath, success: true, size: buffer.byteLength }
  } catch (err) {
    return {
      path: outputPath,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// --- Concurrency limiter ---

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

// --- Main logic ---

async function getChampionList(): Promise<ChampionSummary[]> {
  console.log('📋 Fetching champion list from CommunityDragon...')
  const data = await fetchJSON<ChampionSummary[]>(`${CDRAGON_BASE}/champion-summary.json`)
  return data.filter((c) => c.id > 0) // Remove the "None" entry (id: -1)
}

async function getChampionData(id: number): Promise<ChampionData> {
  const data = await fetchJSON<any>(`${CDRAGON_BASE}/champions/${id}.json`)
  return {
    id: data.id,
    name: data.name,
    alias: data.alias,
    skins: data.skins.map((s: any) => ({
      id: s.id,
      name: s.name,
      isBase: s.isBase,
    })),
  }
}

function getModelUrl(alias: string, skinId: number, quality: 'lite' | 'full'): string {
  const filename = quality === 'full' ? 'model.glb' : 'model-lite.glb'
  return `${CDN_BASE}/models/${alias.toLowerCase()}/${skinId}/${filename}`
}

async function downloadChampion(
  champion: ChampionData,
  quality: 'lite' | 'full',
  force = false,
): Promise<{ downloaded: number; skipped: number; failed: number }> {
  const alias = champion.alias.toLowerCase()
  const stats = { downloaded: 0, skipped: 0, failed: 0 }

  const skins = flags.baseOnly ? champion.skins.filter((s) => s.isBase) : champion.skins
  for (const skin of skins) {
    const url = getModelUrl(alias, skin.id, quality)
    const skinLabel = skin.isBase ? 'base' : skin.name
    const outputPath = join(OUTPUT_DIR, 'champions', alias, `${skin.id}.glb`)

    if (!force && (await exists(outputPath))) {
      stats.skipped++
      continue
    }

    const result = await downloadFile(url, outputPath, force)

    if (result.success) {
      stats.downloaded++
      console.log(`  ✅ ${champion.name} - ${skinLabel} (${formatSize(result.size!)})`)
    } else {
      stats.failed++
      console.log(`  ❌ ${champion.name} - ${skinLabel}: ${result.error}`)
    }
  }

  return stats
}

// --- Extras (towers, minions, etc.) ---

const EXTRAS_CDN = 'https://cdn.modelviewer.lol/extras'

interface ExtraModel {
  alias: string
  category: string
}

async function getExtrasList(): Promise<ExtraModel[]> {
  console.log('📋 Fetching extras list from modelviewer.lol...')
  const res = await fetch('https://modelviewer.lol/extras')
  const html = await res.text()

  // Extract aliases from the HTML (pattern: alias=XXXXX)
  const aliasRegex = /alias=([^&"]+)/g
  const aliases = new Set<string>()
  let match
  while ((match = aliasRegex.exec(html)) !== null) {
    aliases.add(match[1])
  }

  // Categorize by prefix
  const models: ExtraModel[] = []
  for (const alias of aliases) {
    let category = 'misc'
    if (alias.startsWith('tft') || alias.startsWith('durian_') || alias.startsWith('custom_tft'))
      category = 'tft'
    else if (alias.startsWith('sru_')) category = 'summoners_rift'
    else if (alias.startsWith('ha_') || alias.startsWith('habw_')) category = 'howling_abyss'
    else if (alias.startsWith('bw_')) category = 'bilgewater'
    else if (alias.startsWith('cherry_')) category = 'arena'
    else if (alias.startsWith('strawberry_')) category = 'swarm'
    else if (alias.startsWith('crepe_')) category = 'crepe'
    else if (alias.startsWith('slime_')) category = 'slime'
    else if (alias.startsWith('ruby_')) category = 'doom_bots'
    else if (alias.includes('trinket') || alias.includes('ward')) category = 'wards'
    else if (alias.includes('hexgate') || alias.includes('portal') || alias.includes('gate'))
      category = 'structures'
    else if (alias.includes('poro')) category = 'howling_abyss'
    else if (alias.includes('minion')) category = 'minions'
    else if (alias.includes('dragon')) category = 'summoners_rift'
    else if (
      alias.includes('tower') ||
      alias.includes('turret') ||
      alias.includes('nexus') ||
      alias.includes('inhibitor')
    )
      category = 'structures'

    models.push({ alias, category })
  }

  return models
}

// --- CLI ---

async function main() {
  console.log('🎮 League of Legends Asset Downloader\n')
  console.log(`   CDN: ${CDN_BASE}`)
  console.log(`   Output: ${OUTPUT_DIR}`)
  console.log(`   Quality: ${flags.quality}`)
  console.log(`   Force: ${flags.force}`)
  console.log(`   Concurrency: ${flags.concurrency}\n`)

  // Get champion list
  const champions = await getChampionList()
  console.log(`📊 Found ${champions.length} champions\n`)

  // --- List mode ---
  if (flags.list) {
    for (const c of champions) {
      console.log(`  ${c.id.toString().padStart(4)} | ${c.alias.padEnd(16)} | ${c.name}`)
    }
    return
  }

  // --- Filter by champion ---
  const targetChampions = flags.champion
    ? champions.filter((c) => c.alias.toLowerCase() === flags.champion.toLowerCase())
    : champions

  if (flags.champion && targetChampions.length === 0) {
    console.error(`❌ Champion "${flags.champion}" not found`)
    process.exit(1)
  }

  // --- Download ---
  await mkdir(OUTPUT_DIR, { recursive: true })

  const totals = { downloaded: 0, skipped: 0, failed: 0 }

  await pooled(targetChampions, flags.concurrency, async (champ, i) => {
    console.log(`\n[${i + 1}/${targetChampions.length}] 🏆 ${champ.name} (${champ.alias})`)

    try {
      const champData = await getChampionData(champ.id)
      console.log(`   ${champData.skins.length} skins found`)

      if (flags.dryRun) {
        for (const skin of champData.skins) {
          const url = getModelUrl(champ.alias.toLowerCase(), skin.id, flags.quality)
          console.log(`   [dry-run] ${skin.name}: ${url}`)
        }
        return
      }

      const stats = await downloadChampion(champData, flags.quality, flags.force)
      totals.downloaded += stats.downloaded
      totals.skipped += stats.skipped
      totals.failed += stats.failed
    } catch (err) {
      console.error(`   ❌ Error fetching data for ${champ.name}: ${err}`)
    }
  })

  // --- Extras ---
  if (flags.extras) {
    console.log('\n\n📦 Downloading extras (towers, minions, monsters...)...\n')
    let extras = await getExtrasList()

    if (!flags.includeTft) {
      const before = extras.length
      extras = extras.filter((e) => e.category !== 'tft')
      console.log(
        `   ${before} extras found, ${before - extras.length} TFT excluded (use --include-tft to include)`,
      )
    }

    console.log(`   ${extras.length} extras to download\n`)

    await pooled(extras, flags.concurrency, async (extra, i) => {
      const filename = flags.quality === 'full' ? 'model.glb' : 'model-lite.glb'
      const url = `${EXTRAS_CDN}/models/${extra.alias}/0/${filename}`
      const outputPath = join(OUTPUT_DIR, 'extras', extra.category, `${extra.alias}.glb`)

      if (flags.dryRun) {
        console.log(`   [dry-run] ${extra.alias}: ${url}`)
        return
      }

      const result = await downloadFile(url, outputPath, flags.force)
      if (result.success) {
        totals.downloaded++
        console.log(`  ✅ [${i + 1}/${extras.length}] ${extra.alias} (${formatSize(result.size!)})`)
      } else {
        totals.failed++
        console.log(`  ❌ [${i + 1}/${extras.length}] ${extra.alias}: ${result.error}`)
      }
    })
  }

  // --- Summary ---
  console.log('\n\n📊 Summary:')
  console.log(`   ✅ Downloaded: ${totals.downloaded}`)
  console.log(`   ⏭️  Skipped (already exists): ${totals.skipped}`)
  console.log(`   ❌ Failed: ${totals.failed}`)
  console.log(`\n   Output: ${OUTPUT_DIR}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
