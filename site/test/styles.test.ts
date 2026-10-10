import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(import.meta.dirname, '../src', file), 'utf8')
const base = read('styles/base.css')
const tokens = read('styles/tokens.css')

/** A selector list's selectors, splitting only on commas outside parentheses. */
const selectorList = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/,(?![^(]*\))/)
    .map((s) => s.trim())

/** Every declaration of `property` in a rule whose selector list includes `selector` exactly. */
function declared(css: string, selector: string, property: string): string[] {
  const values: string[] = []
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = selectorList(selectors)
    if (!list.includes(selector)) continue
    for (const [, name, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
      if (name === property) values.push(value.trim())
    }
  }
  return values
}

/** A token's hex value, following `var(--other)` references. */
const token = (name: string): string => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6}|var\\(--[\\w-]+\\))`, 'i').exec(tokens)
  if (!match) throw new Error(`no --${name} token`)
  const ref = /^var\(--([\w-]+)\)$/.exec(match[1])
  return ref ? token(ref[1]) : match[1]
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

function luminance([r, g, b]: number[]): number {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Resolves `var(--x)`, a hex color, or `color-mix(in srgb, A, B N%)` to RGB. */
function color(value: string): number[] {
  const mix = /^color-mix\(in srgb,\s*([^,]+),\s*(\S+)\s+(\d+)%\)$/.exec(value)
  if (mix) {
    const [a, b, share] = [color(mix[1]), color(mix[2]), Number(mix[3]) / 100]
    return a.map((c, i) => Math.round(c * (1 - share) + b[i] * share))
  }
  const variable = /^var\(--([\w-]+)\)$/.exec(value)
  if (variable) return rgb(token(variable[1]))
  if (value === '#fff') return [255, 255, 255]
  return rgb(value)
}

describe('button colors', () => {
  it('keeps the label at 4.5:1 or more, at rest and on hover', () => {
    const label = color(declared(base, '.button', 'color')[0])
    for (const selector of ['.button', '.button:hover']) {
      const background = declared(base, selector, 'background')[0]
      expect(contrast(color(background), label), selector).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('touch targets', () => {
  it.each(['.button', '.button.small', '.nav .sign-in', '.footer nav a'])(
    'gives %s a hit area at least 44px tall',
    (selector) => {
      const heights = declared(base, selector, 'min-height').map((v) => Number.parseFloat(v))
      expect(heights.length, selector).toBeGreaterThan(0)
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(44)
    },
  )

  it('gives the section links in the nav a hit area at least 44px tall', () => {
    const heights = declared(base, '.nav .sections a', 'min-height').map(Number.parseFloat)
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44)
  })
})

describe('text colors', () => {
  it.each([
    ['ink', 'paper'],
    ['ink-2', 'paper'],
    ['ink-2', 'mist'],
    ['placeholder', 'paper'],
    ['error', 'paper'],
    ['slate', 'coral-wash'],
    ['on-coral-wash', 'coral-wash'],
  ])('keeps --%s on --%s at 4.5:1 or more', (fg, bg) => {
    expect(contrast(color(`var(--${fg})`), color(`var(--${bg})`))).toBeGreaterThanOrEqual(4.5)
  })
})
