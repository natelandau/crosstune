import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import assetsConfig from './pwa-assets.config'
import { pwaOptions } from './pwa.config'
import { parseBrand, readBrand } from './src/test/brand'

describe('pwaOptions', () => {
  it('never caches the API', () => {
    const denylist = pwaOptions.workbox?.navigateFallbackDenylist ?? []
    expect(denylist.some((re) => re.test('/v1/songs'))).toBe(true)
    expect(denylist.some((re) => re.test('/v1/'))).toBe(true)
    expect(pwaOptions.workbox?.runtimeCaching).toEqual([])
  })

  it('updates the shell in place and stays enabled', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate')
    expect(pwaOptions.disable).not.toBe(true)
  })

  it('ships every icon the manifest lists', () => {
    const manifest = pwaOptions.manifest
    if (!manifest) throw new Error('manifest is off')
    const icons = manifest.icons ?? []
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) {
      expect(existsSync(resolve(import.meta.dirname, 'public', icon.src)), icon.src).toBe(true)
    }
  })

  it('serves the brand tile as the SVG favicon', () => {
    const served = readFileSync(resolve(import.meta.dirname, 'public/logo.svg'), 'utf8')
    expect(served).toBe(readBrand('icon-dark.svg'))
  })

  it('keeps the whole mark inside the maskable safe zone', () => {
    // A launcher may mask the maskable icon to a circle of 80% of its width. The mark is drawn
    // scaled about the tile's center in the source, then the generator draws the tile at
    // (1 - padding) of the icon, so both factors set how far the mark reaches from the center.
    const preset = assetsConfig.preset
    if (!preset || typeof preset === 'string') throw new Error('preset is not an inline config')
    const padding = preset.maskable.padding ?? 0
    const transform = parseBrand('icon-dark.svg').querySelector('g')?.getAttribute('transform')
    const scale = Number(/scale\(([\d.]+)\)/.exec(transform ?? '')?.[1])
    expect(transform).toContain('translate(256 256)')
    expect(scale).toBeGreaterThan(0)

    const viewBox = parseBrand('mark-dark.svg').documentElement.getAttribute('viewBox') ?? ''
    const [x = NaN, y = NaN, w = NaN, h = NaN] = viewBox.split(' ').map(Number)
    const corners: [number, number][] = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ]
    const reach = Math.max(
      ...corners.map(([cx, cy]) => Math.hypot(cx - 256, cy - 256) * scale * (1 - padding)),
    )
    expect(reach).toBeLessThanOrEqual(0.4 * 512)
  })
})
