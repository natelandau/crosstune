// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { PALETTE, type Palette } from './tokens'

// contrastRatio measures rgb() strings, and the palette is hex.
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

const ratio = (fg: string, bg: string) => contrastRatio(rgb(fg), rgb(bg))

describe.each(['light', 'dark'] as const)('%s palette', (scheme) => {
  const p = PALETTE[scheme]
  it.each([
    ['ink', p.ink, p.ground, 4.5],
    ['secondary ink', p.ink2, p.ground, 4.5],
    ['slate', p.slate, p.ground, 4.5],
    ['label on slate', p.onSlate, p.slate, 4.5],
    ['known glyph', p.known, p.ground, 3],
    ['unknown ring', p.unknown, p.ground, 3],
    ['record', p.record, p.ground, 3],
    ['danger label', p.danger, p.ground, 4.5],
    ['warning label', p.warning, p.ground, 4.5],
    ['label on danger', p.onSlate, p.danger, 4.5],
    ['label on warning', p.onSlate, p.warning, 4.5],
    ['switch track off on its row', p.switchOff, p.fill, 3],
    ['switch track off on the ground', p.switchOff, p.ground, 3],
    ['switch knob on the track off', p.knob, p.switchOff, 3],
    ['switch track on on its row', p.switchOn, p.fill, 3],
    ['switch knob on the track on', p.knob, p.switchOn, 3],
    ['ink on the nav', p.ink, p.nav, 4.5],
    ['secondary ink on the nav', p.navInk2, p.nav, 4.5],
    ['known glyph on the nav', p.known, p.nav, 3],
    ['unknown ring on the nav', p.navUnknown, p.nav, 3],
    ['current tab on the nav', p.slate, p.nav, 4.5],
  ])('%s passes', (_, fg, bg, min) => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min))
})

// Learning is Apple's system orange, below 3:1 on a light ground; its half fill carries the status.
it.each([
  ['light', '#FF8D28'],
  ['dark', '#FF9230'],
] as const)("draws learning in Apple's %s orange", (scheme, orange) => {
  expect(PALETTE[scheme].learning).toBe(orange)
})

it.each(['light', 'dark'] as const)('practice reads on %s jet', (scheme) => {
  const jet = PALETTE[scheme].jet
  expect(ratio('#FFFFFF', jet)).toBeGreaterThanOrEqual(4.5)
  expect(ratio(PALETTE.light.silver, jet)).toBeGreaterThanOrEqual(4.5)
  expect(ratio(PALETTE.light.coral, jet)).toBeGreaterThanOrEqual(3)
})

// Read from disk: the unit project hands CSS imports, raw ones included, over empty.
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

/** The custom properties a block of tokens.css sets, by name. */
function declared(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  const body = css.slice(start, css.indexOf('\n}', start))
  const values = new Map<string, string>()
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) values.set(name!, value!)
  return values
}

// One spelling for a color however it is written: lowercase, no spaces, no trailing zeros.
const normal = (color: string) =>
  color
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(\.\d*?)0+\)/, '$1)')
    .replace(/\.\)/, ')')

const property = (key: string) => `--${key.replace(/[A-Z]|\d+/g, (m) => `-${m.toLowerCase()}`)}`

describe.each(['light', 'dark'] as const)('tokens.css in %s', (scheme) => {
  const light = declared(':root')
  // A dark value falls back to the light one where the dark block does not set it.
  const set =
    scheme === 'light' ? light : new Map([...light, ...declared(":root[data-scheme='dark']")])
  // A value that names another token reads as that token's value, through any chain of names.
  const resolve = (value: string): string => {
    const ref = /^var\((--[\w-]+)\)$/.exec(value)?.[1]
    const named = ref === undefined ? undefined : set.get(ref)
    return named === undefined ? value : resolve(named)
  }
  const values = new Map([...set].map(([name, value]) => [name, resolve(value)]))
  it.each(Object.keys(PALETTE[scheme]) as (keyof Palette)[])('matches tokens.ts for %s', (key) => {
    expect(normal(values.get(property(key)) ?? 'missing')).toBe(normal(PALETTE[scheme][key]))
  })
})

it("gives practice the dark scheme's danger in either appearance", () => {
  expect(normal(declared(':root').get('--danger-dark') ?? 'missing')).toBe(
    normal(PALETTE.dark.danger),
  )
})
