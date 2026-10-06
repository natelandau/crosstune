import { describe, expect, it } from 'vitest'
import { formatManifest, mergeManifest } from '../../capture/manifest.ts'
import type { CaptureEntry, Manifest } from '../../capture/types.ts'

const clip = (name: string, duration: number): CaptureEntry => ({
  kind: 'clip',
  video: `${name}.mp4`,
  poster: `${name}.png`,
  width: 720,
  height: 1566,
  duration,
  device: 'iphone',
})

describe('mergeManifest', () => {
  const old: Manifest = {
    captures: {
      tunes: clip('tunes', 9),
      lists: { kind: 'still', image: 'lists.png', width: 1206, height: 2622, device: 'iphone' },
    },
  }

  it('replaces only the updated entries and keeps the rest byte-identical', () => {
    const merged = mergeManifest(old, { tunes: clip('tunes', 11) })
    expect(merged.captures.tunes).toEqual(clip('tunes', 11))
    expect(JSON.stringify(merged.captures.lists)).toBe(JSON.stringify(old.captures.lists))
    expect(old.captures.tunes).toEqual(clip('tunes', 9))
  })

  it('sorts the keys', () => {
    const merged = mergeManifest(old, { 'hero-jam': clip('hero-jam', 8) })
    expect(Object.keys(merged.captures)).toEqual(['hero-jam', 'lists', 'tunes'])
  })

  it('formats as two-space JSON with a trailing newline', () => {
    expect(formatManifest({ captures: {} })).toBe('{\n  "captures": {}\n}\n')
  })
})
