import { readFileSync } from 'node:fs'
import type { ClipRecipe } from './synthesize'

interface ClipFile {
  seed: number
  clips: ClipRecipe[]
}

let cached: ClipFile | undefined

function clipFile(): ClipFile {
  cached ??= JSON.parse(
    readFileSync(new URL('../../../fixtures/tuner/clips.json', import.meta.url), 'utf8'),
  ) as ClipFile
  return cached
}

export function loadClips(): ClipRecipe[] {
  return clipFile().clips
}

export function clipSeed(): number {
  return clipFile().seed
}
