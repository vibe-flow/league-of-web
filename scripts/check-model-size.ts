#!/usr/bin/env bun
/**
 * Quick script to check the bounding box size of a GLB model.
 */
import { readFile } from 'fs/promises'
import { join } from 'path'

const ASSETS_DIR = join(import.meta.dir, '..', 'assets', 'lol', 'champions')

// Check a few champions
const champions = ['ahri', 'garen', 'jinx', 'lux']

for (const champ of champions) {
  const { readdir } = await import('fs/promises')
  const files = await readdir(join(ASSETS_DIR, champ))
  const firstGlb = files.find((f: string) => f.endsWith('.glb'))
  if (!firstGlb) continue

  const filePath = join(ASSETS_DIR, champ, firstGlb)
  const stats = await Bun.file(filePath).stat()
  console.log(`${champ}/${firstGlb}: ${(stats?.size ?? 0 / 1024 / 1024).toFixed(1)} bytes`)
}

console.log('\nTo check actual 3D dimensions, run in browser console:')
console.log('  const loader = new THREE.GLTFLoader()')
console.log('  loader.load("/lol-assets/champions/ahri/103000.glb", (gltf) => {')
console.log('    const box = new THREE.Box3().setFromObject(gltf.scene)')
console.log('    console.log("size:", box.getSize(new THREE.Vector3()))')
console.log('    console.log("min:", box.min)')
console.log('    console.log("max:", box.max)')
console.log('  })')
