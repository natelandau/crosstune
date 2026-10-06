import { existsSync, readdirSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../src/assets/captures/captures.json'
import { getCapture, hasCapture } from '../src/components/capture/captures'
import { readPage } from './dist'

const doc = readPage('/')
const astroDir = resolve(import.meta.dirname, '../dist/_astro')
const videos = [...doc.querySelectorAll<HTMLVideoElement>('video[data-capture]')]

describe('getCapture', () => {
  it('throws for a name the manifest lacks', () => {
    expect(() => getCapture('nope')).toThrow('Unknown capture: nope')
  })

  it('returns the manifest entry with a resolved src', () => {
    const entry = getCapture('lists')
    expect(entry.kind).toBe('clip')
    expect(entry.src).toBeTruthy()
  })
})

describe('hasCapture', () => {
  it('is true for a name in the manifest', () => {
    expect(hasCapture('family-web')).toBe(true)
  })

  it('is false, without throwing, for a name the manifest lacks', () => {
    expect(hasCapture('nope')).toBe(false)
    expect(hasCapture('toString')).toBe(false)
  })
})

describe('captures on the home page', () => {
  it('renders at least one capture', () => {
    expect(videos.length).toBeGreaterThan(0)
  })

  it('ships only the optimized images, never a full-size capture PNG', () => {
    expect(readdirSync(astroDir).filter((file) => file.endsWith('.png'))).toEqual([])
  })

  it('lazy-loads every clip: data-src names a built file, no src, no preload', () => {
    for (const video of videos) {
      const src = video.getAttribute('data-src') ?? ''
      expect(existsSync(resolve(astroDir, basename(src))), src).toBe(true)
      expect(video.hasAttribute('src')).toBe(false)
      expect(video.querySelector('source[src]')).toBeNull()
      expect(video.getAttribute('preload')).toBe('none')
      expect(video.hasAttribute('muted')).toBe(true)
      expect(video.hasAttribute('playsinline')).toBe(true)
      expect(video.hasAttribute('loop')).toBe(true)
    }
  })

  it('names a manifest clip and ships an optimized poster', () => {
    for (const video of videos) {
      const name = video.getAttribute('data-capture') ?? ''
      expect(manifest.captures, name).toHaveProperty(name)
      // A clip whose poster loads lazily, first, or by script carries it as the <img> before it.
      const image = video.previousElementSibling?.matches('img.poster')
        ? video.previousElementSibling
        : null
      const poster =
        video.getAttribute('poster') ??
        image?.getAttribute('src') ??
        image?.getAttribute('data-src') ??
        ''
      expect(poster).toMatch(/\.(webp|avif)$/)
      expect(existsSync(resolve(astroDir, basename(poster))), poster).toBe(true)
    }
  })

  it('renders each still as AVIF and WebP at its shown width and twice that', () => {
    const stills = [...doc.querySelectorAll('picture')]
    expect(stills.length).toBeGreaterThan(0)
    for (const picture of stills) {
      const img = picture.querySelector('img.capture')!
      expect(img.getAttribute('alt')).toBeTruthy()
      const sources = [...picture.querySelectorAll('source')]
      expect(sources.map((s) => s.getAttribute('type'))).toEqual(['image/avif', 'image/webp'])
      for (const el of [...sources, img]) {
        const srcset = el.getAttribute('srcset') ?? el.getAttribute('data-srcset') ?? ''
        const widths = srcset.split(', ').map((entry) => Number(entry.split(' ')[1]?.slice(0, -1)))
        expect(widths.length, srcset).toBeGreaterThan(0)
        expect(widths[1] ?? widths[0] * 2).toBe(widths[0] * 2)
        expect(el.getAttribute('sizes')).toBeTruthy()
        for (const entry of srcset.split(', ')) {
          expect(existsSync(resolve(astroDir, basename(entry.split(' ')[0]))), entry).toBe(true)
        }
      }
    }
  })

  it('leaves the URLs of every inactive stage image for the script to set', () => {
    const stages = [...doc.querySelectorAll('[data-stage]')]
    expect(stages.length).toBeGreaterThan(0)
    for (const stage of stages) {
      const [first, ...rest] = [...stage.querySelectorAll('[data-stage-item]')]
      expect(first.querySelector('img[data-src], [data-srcset]')).toBeNull()
      for (const item of rest) {
        for (const el of item.querySelectorAll('img, source')) {
          expect(el.hasAttribute('src')).toBe(false)
          expect(el.hasAttribute('srcset')).toBe(false)
          expect(el.hasAttribute('data-src') || el.hasAttribute('data-srcset')).toBe(true)
        }
      }
    }
  })

  it('describes each clip and hides it only as an inactive stage capture or stacked phone', () => {
    for (const video of videos) {
      expect(video.getAttribute('aria-label')).toBeTruthy()
      const inactive = video.closest(
        '[data-stage-item]:not([data-active]), [data-stack-item]:not(.is-active)',
      )
      expect(video.closest('[aria-hidden="true"]')).toBe(inactive)
    }
  })
})
