import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { kp, PITCH, wave } from '../../src/demos/atoms'
import { MOBILE_BELOW, scaleFor } from '../../src/demos/camera'
import { DEMOS } from '../../src/demos/index'

const read = (file: string) => readFileSync(resolve(import.meta.dirname, '../../src', file), 'utf8')

describe('scaleFor', () => {
  it('keeps a feature panel between 0.6 and 0.74', () => {
    expect(scaleFor('feat', 300, false)).toBe(0.6)
    expect(scaleFor('feat', 728, false)).toBeCloseTo(0.7)
    expect(scaleFor('feat', 2000, false)).toBe(0.74)
  })

  it('zooms the practice crop past the feature scale', () => {
    expect(scaleFor('zoom', 728, false)).toBeCloseTo(0.7 * 1.3)
    expect(scaleFor('zoom', 378, true)).toBeCloseTo(0.7 * 1.24)
  })

  it('fits the platforms shot to the panel without a floor', () => {
    expect(scaleFor('plat', 1190, false)).toBeCloseTo(0.5)
    expect(scaleFor('plat', 450, true)).toBeCloseTo(0.5)
  })

  it('switches to mobile below 640 pixels', () => {
    expect(MOBILE_BELOW).toBe(640)
  })
})

describe('the CSS scale', () => {
  const css = read('styles/demos.css')

  it('uses the same divisors and bounds as camera.ts', () => {
    for (const rule of [
      'clamp(0.6px, 100cqw / 1040, 0.74px)',
      'clamp(0.6px, 100cqw / 540, 0.74px)',
      'clamp(0.6px, 100cqw / 650, 0.86px)',
      'clamp(0.6px, 100cqw / 470, 0.86px)',
      'clamp(0.5px, 100cqw / 1520, 0.8px)',
      'clamp(0.55px, 100cqw / 560, 0.74px)',
      'calc(100cqw / 2380)',
      'calc(100cqw / 900)',
      '@container (width < 640px)',
    ]) {
      expect(css).toContain(rule)
    }
  })

  it('makes every device its own stacking context', () => {
    expect(css).toMatch(/\.stage > \[data-y\] \{[^}]*isolation: isolate/)
    expect(css).toMatch(/\.bw \{[^}]*isolation: isolate/)
  })
})

describe('atoms', () => {
  it('colors a key pill by its pitch class', () => {
    expect(kp('D')).toContain(`k${PITCH.D}`)
    expect(kp('A', 'dor')).toContain('A dor')
  })

  it('draws the same waveform every time', () => {
    expect(wave(20, 2.2, 100)).toBe(wave(20, 2.2, 100))
  })
})

describe('every demo', () => {
  for (const [name, def] of Object.entries(DEMOS)) {
    it(`${name} has a label, heights, and stable markup`, () => {
      expect(def.label.length).toBeGreaterThan(20)
      expect(def.h).toBeGreaterThan(0)
      expect(def.hm).toBeGreaterThan(0)
      expect(def.markup()).toBe(def.markup())
    })

    it(`${name} places each device from data attributes`, () => {
      expect(def.markup()).toMatch(/data-y="\d+"/)
    })
  }

  it('says scans, never notation', () => {
    const text = Object.values(DEMOS)
      .map((d) => d.markup() + d.label)
      .join('')
    expect(text.toLowerCase()).not.toContain('notation')
    for (const file of [
      'styles/demos.css',
      'components/Places.astro',
      'components/DemoPanel.astro',
    ]) {
      expect(read(file).toLowerCase()).not.toContain('notation')
    }
  })

  it('carries no script or external font', () => {
    for (const def of Object.values(DEMOS)) expect(def.markup()).not.toMatch(/<script/i)
    expect(read('styles/demos.css')).not.toContain('fonts.googleapis')
  })
})

describe('DemoPanel', () => {
  const panel = read('components/DemoPanel.astro')

  it('names the demo as an image and hides the drawn screens', () => {
    expect(panel).toMatch(/role="img"\s+aria-label=\{def\.label\}/)
    expect(panel).toMatch(/class="stage ui" aria-hidden="true"/)
  })

  it('hides the controls until the script shows them', () => {
    expect(panel).toContain('<div class="demo-ctl" hidden>')
  })
})
