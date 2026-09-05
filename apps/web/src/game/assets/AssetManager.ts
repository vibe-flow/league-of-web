import type * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'

interface CachedModel {
  scene: THREE.Group
  animations: THREE.AnimationClip[]
}

/**
 * Centralized asset loader for GLB 3D models.
 * Handles loading, caching, and cloning of champion models.
 *
 * Usage:
 *   const manager = AssetManager.getInstance()
 *   await manager.preloadChampion('ahri', '103000')
 *   const { model, animations } = manager.getChampionModel('ahri', '103000')
 */
export class AssetManager {
  private static instance: AssetManager
  private loader: GLTFLoader
  private cache = new Map<string, CachedModel>()
  private loadingPromises = new Map<string, Promise<CachedModel>>()

  private constructor() {
    this.loader = new GLTFLoader()

    // Optional: DRACO compression support for smaller GLB files
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/')
    this.loader.setDRACOLoader(dracoLoader)
  }

  static getInstance(): AssetManager {
    if (!AssetManager.instance) {
      AssetManager.instance = new AssetManager()
    }
    return AssetManager.instance
  }

  private getCacheKey(championAlias: string, skinId: string): string {
    return `${championAlias}/${skinId}`
  }

  private getModelPath(championAlias: string, skinId: string): string {
    return `/lol-assets/champions/${championAlias}/${skinId}.glb`
  }

  /**
   * Preload a champion skin model. Returns when the model is cached.
   * Safe to call multiple times — deduplicates in-flight requests.
   */
  async preloadChampion(championAlias: string, skinId: string): Promise<void> {
    const key = this.getCacheKey(championAlias, skinId)
    const modelPath = this.getModelPath(championAlias, skinId)

    // Already cached
    if (this.cache.has(key)) return

    // Already loading
    if (this.loadingPromises.has(key)) {
      await this.loadingPromises.get(key)
      return
    }

    const promise = new Promise<CachedModel>((resolve, reject) => {
      this.loader.load(
        modelPath,
        (gltf) => {
          const cached: CachedModel = {
            scene: gltf.scene,
            animations: gltf.animations,
          }
          this.cache.set(key, cached)
          this.loadingPromises.delete(key)
          console.log(
            `[AssetManager] Loaded: ${championAlias}/${skinId} (${gltf.animations.length} animations)`,
          )
          resolve(cached)
        },
        undefined,
        (error) => {
          this.loadingPromises.delete(key)
          console.warn(`[AssetManager] Failed to load: ${championAlias}/${skinId}`, error)
          reject(error)
        },
      )
    })

    this.loadingPromises.set(key, promise)
    await promise
  }

  /**
   * Get a cloned instance of a champion model with its own skeleton.
   * Each clone has independent animations.
   * The model must be preloaded first.
   */
  getChampionModel(
    championAlias: string,
    skinId: string,
  ): { model: THREE.Group; animations: THREE.AnimationClip[] } | null {
    const key = this.getCacheKey(championAlias, skinId)
    const cached = this.cache.get(key)
    if (!cached) return null

    return {
      model: SkeletonUtils.clone(cached.scene) as THREE.Group,
      animations: cached.animations,
    }
  }

  /**
   * Check if a champion skin model is loaded.
   */
  isLoaded(championAlias: string, skinId: string): boolean {
    const key = this.getCacheKey(championAlias, skinId)
    return this.cache.has(key)
  }

  /**
   * Preload multiple champion skins in parallel.
   * Resolves when all are loaded (ignores individual failures).
   */
  async preloadChampions(entries: Array<{ alias: string; skinId: string }>): Promise<void> {
    await Promise.allSettled(entries.map((e) => this.preloadChampion(e.alias, e.skinId)))
  }

  /**
   * List animation clip names for a loaded champion model.
   * Useful for debugging and mapping animations.
   */
  getAnimationNames(championAlias: string, skinId: string): string[] {
    const key = this.getCacheKey(championAlias, skinId)
    const cached = this.cache.get(key)
    if (!cached) return []
    return cached.animations.map((clip) => clip.name)
  }

  // ===========================================================================
  // Generic asset loading (maps, structures, extras)
  // ===========================================================================

  /**
   * Preload any GLB asset by key and path. Uses the same cache and
   * deduplication as champion models.
   */
  async preloadAsset(key: string, path: string): Promise<void> {
    if (this.cache.has(key)) return

    if (this.loadingPromises.has(key)) {
      await this.loadingPromises.get(key)
      return
    }

    const promise = new Promise<CachedModel>((resolve, reject) => {
      this.loader.load(
        path,
        (gltf) => {
          const cached: CachedModel = {
            scene: gltf.scene,
            animations: gltf.animations,
          }
          this.cache.set(key, cached)
          this.loadingPromises.delete(key)
          console.log(`[AssetManager] Loaded asset: ${key} (${gltf.animations.length} animations)`)
          resolve(cached)
        },
        undefined,
        (error) => {
          this.loadingPromises.delete(key)
          console.warn(`[AssetManager] Failed to load asset: ${key}`, error)
          reject(error)
        },
      )
    })

    this.loadingPromises.set(key, promise)
    await promise
  }

  /**
   * Get the original scene of a loaded asset (no clone).
   * Use for unique assets like the map terrain.
   */
  getAssetScene(key: string): THREE.Group | null {
    return this.cache.get(key)?.scene ?? null
  }

  /**
   * Get a cloned instance of a loaded asset with independent skeleton.
   * Use for assets that need multiple copies (e.g. towers).
   */
  getAssetClone(key: string): { model: THREE.Group; animations: THREE.AnimationClip[] } | null {
    const cached = this.cache.get(key)
    if (!cached) return null
    return {
      model: SkeletonUtils.clone(cached.scene) as THREE.Group,
      animations: cached.animations,
    }
  }

  /**
   * Preload multiple assets in parallel. Ignores individual failures.
   */
  async preloadAssets(entries: Array<{ key: string; path: string }>): Promise<void> {
    await Promise.allSettled(entries.map((e) => this.preloadAsset(e.key, e.path)))
  }
}
