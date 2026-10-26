// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio, relativeLuminance } from '../test/contrast'
import { HEAT_STEPS, KEY_COLORS, LOOP_COLORS, PALETTE, type Palette } from './tokens'

// contrastRatio measures rgb() strings, and the palette is hex.
function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

const ratio = (fg: string, bg: string) => contrastRatio(rgb(fg), rgb(bg))

type Case = [string, string, string, number]

describe.each(['light', 'dark'] as const)('%s palette', (scheme) => {
  const p = PALETTE[scheme]
  const grounds = [
    ['ground', p.ground],
    ['surface', p.surface],
    ['field', p.field],
    ['raised', p.raised],
  ] as const
  const cases: Case[] = [
    ...grounds.flatMap(([name, bg]): Case[] => [
      [`ink on ${name}`, p.ink, bg, 4.5],
      [`secondary ink on ${name}`, p.ink2, bg, 4.5],
      [`accent on ${name}`, p.accent, bg, 4.5],
    ]),
    ['dimmed title on the ground', p.inkDim, p.ground, 4.5],
    ['a glyph that cannot act on the ground', p.glyphOff, p.ground, 3],
    ['label on the accent fill', p.onAccentFill, p.accentFill, 4.5],
    ['the mark on the ground', p.markInk, p.ground, 3],
    ['label on coral', p.onCoral, p.coral, 4.5],
    ['label on jet', p.onJet, p.jet, 4.5],
    ['absence mark on a card', p.glyphFaint, p.surface, 3],
    ['absence mark on the ground', p.glyphFaint, p.ground, 3],
    ...(['ground', 'surface'] as const).flatMap((name): Case[] => [
      [`known glyph on ${name}`, p.known, p[name], 3],
      [`record on ${name}`, p.record, p[name], 3],
    ]),
    ['unknown ring on the ground', p.unknown, p.ground, 3],
    ['unknown ring on a surface', p.unknownOnSurface, p.surface, 3],
    ...grounds.flatMap(([name, bg]): Case[] => [
      [`danger label on ${name}`, p.danger, bg, 4.5],
      [`warning label on ${name}`, p.warning, bg, 4.5],
    ]),
    ['label on danger', p.onTone, p.danger, 4.5],
    ['label on the record fill', p.onRecord, p.record, 4.5],
    ['label on the record fill under the pointer', p.onRecord, p.recordHover, 4.5],
    ['label on warning', p.onTone, p.warning, 4.5],
    ...grounds
      .filter(([name]) => name !== 'field')
      .flatMap(([name, bg]): Case[] => [
        [`switch track off on ${name}`, p.switchOff, bg, 3],
        [`switch track on on ${name}`, p.switchOn, bg, 3],
      ]),
    ['switch knob on the track off', p.knob, p.switchOff, 3],
    ['switch knob on the track on', p.knob, p.switchOn, 3],
    ['label on a disabled fill', p.disabledInk, p.disabledFill, 4.5],
    // Off, a filled control still stands apart from what it sits on.
    ['disabled fill on the ground', p.disabledFill, p.ground, 1.2],
    ['disabled fill on a surface', p.disabledFill, p.surface, 1.2],
  ]
  it.each(cases)('%s passes', (_, fg, bg, min) => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min))
})

// Learning is Apple's system orange, below 3:1 on a light ground; its half fill carries the status.
it.each([
  ['light', '#FF8D28'],
  ['dark', '#FF9230'],
] as const)("draws learning in Apple's %s orange", (scheme, orange) => {
  expect(PALETTE[scheme].learning).toBe(orange)
})

// A dimmed title still reads as a title: quieter than ink, louder than secondary ink.
it.each(['light', 'dark'] as const)('dims the %s title between ink and secondary ink', (scheme) => {
  const p = PALETTE[scheme]
  const fromGround = (ink: string) => ratio(ink, p.ground)
  expect(fromGround(p.inkDim)).toBeLessThan(fromGround(p.ink))
  expect(fromGround(p.inkDim)).toBeGreaterThan(fromGround(p.ink2))
})

it.each(['light', 'dark'] as const)(
  'draws a %s glyph that cannot act fainter than secondary ink',
  (scheme) => {
    const p = PALETTE[scheme]
    expect(ratio(p.glyphOff, p.ground)).toBeLessThan(ratio(p.ink2, p.ground))
  },
)

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

/** Every token tokens.css sets in a scheme, with a value that names another token resolved. */
function tokens(scheme: 'light' | 'dark'): Map<string, string> {
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
  return new Map([...set].map(([name, value]) => [name, resolve(value)]))
}

describe.each(['light', 'dark'] as const)('tokens.css in %s', (scheme) => {
  const values = tokens(scheme)
  it.each(Object.keys(PALETTE[scheme]) as (keyof Palette)[])('matches tokens.ts for %s', (key) => {
    expect(normal(values.get(property(key)) ?? 'missing')).toBe(normal(PALETTE[scheme][key]))
  })
})

describe.each(['light', 'dark'] as const)('the music palettes in %s', (scheme) => {
  const values = tokens(scheme)
  const css = (name: string) => normal(values.get(name) ?? 'missing')

  it.each(KEY_COLORS[scheme].map((colors, pitch) => [pitch, colors] as const))(
    'matches tokens.ts for key %i',
    (pitch, { bg, ink, onBg, onInk }) => {
      expect(css(`--key-${pitch}-bg`)).toBe(normal(bg))
      expect(css(`--key-${pitch}-ink`)).toBe(normal(ink))
      expect(css(`--key-${pitch}-on-bg`)).toBe(normal(onBg))
      expect(css(`--key-${pitch}-on-ink`)).toBe(normal(onInk))
    },
  )

  it.each(KEY_COLORS[scheme].map((colors, pitch) => [pitch, colors] as const))(
    'keeps key %i legible at rest and chosen',
    (_, { bg, ink, onBg, onInk }) => {
      expect(ratio(ink, bg)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(onInk, onBg)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(LOOP_COLORS[scheme].map((color, slot) => [slot, color] as const))(
    'matches tokens.ts for loop %i, its tint, and keeps its white label legible',
    (slot, color) => {
      expect(css(`--loop-${slot}`)).toBe(normal(color))
      const tint = css(`--loop-${slot}-tint`)
      expect(tint.startsWith(`rgba(${rgb(color).slice(4, -1).replace(/\s/g, '')},`)).toBe(true)
      expect(ratio('#FFFFFF', color)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(HEAT_STEPS[scheme].map((color, step) => [step + 1, color] as const))(
    'matches tokens.ts for heatmap step %i and reads against the page',
    (step, color) => {
      expect(css(`--heat-${step}`)).toBe(normal(color))
      expect(ratio(color, PALETTE[scheme].ground)).toBeGreaterThanOrEqual(3)
    },
  )
})

const practiceTheme = readFileSync(new URL('./practiceTheme.css', import.meta.url), 'utf8')

/** Practice's ground in a scheme: the token practiceTheme.css paints it with, as set there. */
function practiceGround(scheme: 'light' | 'dark'): string {
  const ref = /--panel-ground:\s*var\((--[\w-]+)\);/.exec(practiceTheme)?.[1]
  const value = ref === undefined ? undefined : tokens(scheme).get(ref)
  if (value === undefined) throw new Error('practice paints its ground with no tokens.css color')
  return value
}

describe.each(['light', 'dark'] as const)("practice's ground in %s", (scheme) => {
  const ground = practiceGround(scheme)

  it('keeps white, the accent, silver, and the coral playhead legible', () => {
    expect(ratio('#FFFFFF', ground)).toBeGreaterThanOrEqual(4.5)
    // Practice draws the dark scheme's accent in either appearance, as text and glyphs.
    expect(ratio(PALETTE.dark.accent, ground)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(PALETTE.light.silver, ground)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(PALETTE.light.coral, ground)).toBeGreaterThanOrEqual(3)
  })

  // Practice draws the dark scheme's loops, each under its white name tab.
  it.each(LOOP_COLORS.dark.map((color, slot) => [slot, color] as const))(
    'draws loop %i legibly, under a legible name',
    (slot, color) => {
      expect(normal(declared(':root').get(`--loop-${slot}-dark`) ?? 'missing')).toBe(normal(color))
      expect(ratio(color, ground)).toBeGreaterThanOrEqual(3)
      expect(ratio('#FFFFFF', color)).toBeGreaterThanOrEqual(4.5)
    },
  )

  // The tuner's two off-pitch steps: both legible, and apart in lightness as well as hue, so
  // they stay apart under red-green color blindness.
  it('keeps the tuner steps legible and apart', () => {
    const p = PALETTE[scheme]
    expect(ratio(p.tuneClose, ground)).toBeGreaterThanOrEqual(3)
    expect(ratio(p.coral, ground)).toBeGreaterThanOrEqual(3)
    const gap = relativeLuminance(rgb(p.tuneClose)) - relativeLuminance(rgb(p.coral))
    expect(Math.abs(gap)).toBeGreaterThanOrEqual(0.1)
  })

  // Inside the target zone the bars blend from the close step to green; every color between
  // stays legible.
  it('keeps the tuner bars legible across the blend', () => {
    const bytes = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
    const [close, green] = [bytes(PALETTE[scheme].tuneClose), bytes(PALETTE.dark.known)]
    for (let step = 0; step <= 10; step++) {
      const share = step / 10
      const mixed = close.map((c, i) => Math.round(c * (1 - share) + green[i]! * share))
      const hex = `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
      expect(ratio(hex, ground), `${share} green`).toBeGreaterThanOrEqual(3)
    }
  })
})

it('redeclares every loop color for practice', () => {
  const practice = practiceTheme
  for (let slot = 0; slot < LOOP_COLORS.dark.length; slot++) {
    expect(practice).toContain(`--loop-${slot}: var(--loop-${slot}-dark);`)
    expect(practice).toContain(`--loop-${slot}-tint: var(--loop-${slot}-tint-dark);`)
  }
})

it("gives practice the dark scheme's danger in either appearance", () => {
  expect(normal(declared(':root').get('--danger-dark') ?? 'missing')).toBe(
    normal(PALETTE.dark.danger),
  )
})

it("gives the tuner the dark scheme's known in either appearance", () => {
  expect(normal(declared(':root').get('--known-dark') ?? 'missing')).toBe(
    normal(PALETTE.dark.known),
  )
})

const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
const toHex = (values: number[]) =>
  `#${values.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`

/** The hex color a `color-mix(in srgb, var(--a) N%, var(--b))` token resolves to. */
function mixOf(values: Map<string, string>, name: string): string {
  const match = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\)$/.exec(
    values.get(name) ?? '',
  )
  if (!match) throw new Error(`${name} is not a color-mix of two tokens`)
  const [a, share, b] = [channels(values.get(match[1]!)!), Number(match[2]) / 100, match[3]!]
  const under = channels(values.get(b)!)
  return toHex(a.map((c, i) => c * share + under[i]! * (1 - share)))
}

// The in-tune wash replaces practice's ground under the tuner's white type and green bars.
describe.each(['light', 'dark'] as const)('the tuner wash in %s', (scheme) => {
  const values = tokens(scheme)
  const wash = () => mixOf(values, '--tune-wash')
  it('keeps white type legible', () => expect(ratio('#FFFFFF', wash())).toBeGreaterThanOrEqual(4.5))
  it('keeps the green bars legible', () =>
    expect(ratio(values.get('--known-dark')!, wash())).toBeGreaterThanOrEqual(3))
  it('reads apart from the ground', () => expect(wash()).not.toBe(practiceGround(scheme)))
})

/** The hex color a translucent wash token paints over an opaque ground. */
function washOver(values: Map<string, string>, wash: string, ground: string): string {
  const match = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, transparent\)$/.exec(
    values.get(wash) ?? '',
  )
  if (!match) throw new Error(`${wash} is not a color-mix of a token with transparent`)
  return over(values.get(match[1]!)!, Number(match[2]) / 100, ground)
}

/** The hex color `color` at `alpha` paints over an opaque ground. */
function over(color: string, alpha: number, ground: string): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  const under = channels(ground)
  const mixed = channels(color).map((c, i) => Math.round(c * alpha + under[i]! * (1 - alpha)))
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

describe.each(['light', 'dark'] as const)('washes in %s', (scheme) => {
  const values = tokens(scheme)
  const token = (name: string) => values.get(name)!
  it.each([
    // The comparison's Premium column: the wash over the card it sits on.
    ['Premium value on its wash', '--premium-ink', '--premium-wash', '--surface', 4.5],
    ['Premium check on its wash', '--ink', '--premium-wash', '--surface', 3],
    // A feature's icon tile, on the card its row sits on.
    ['feature icon on its tile', '--ink-2', '--tint', '--surface', 3],
    ['trial card secondary ink on its tint', '--ink-2', '--tint', '--ground', 4.5],
    ['trial card ink on its tint', '--ink', '--tint', '--ground', 4.5],
    ['secondary ink on a selected row', '--ink-2', '--wash', '--ground', 4.5],
    // A dimmed row, such as an archived tune, under each wash a row takes.
    ...(['--row-hover', '--wash', '--play-wash'] as const).flatMap(
      (wash): [string, string, string, string, number][] => [
        [`dimmed title on ${wash}`, '--ink-dim', wash, '--ground', 4.5],
        [`dimmed secondary ink on ${wash}`, '--ink-2', wash, '--ground', 4.5],
        [`a glyph that cannot act on ${wash}`, '--glyph-off', wash, '--ground', 3],
      ],
    ),
    ['ink on a set filter', '--ink', '--set-fill', '--ground', 4.5],
    ['secondary ink on a set filter', '--ink-2', '--set-fill', '--ground', 4.5],
    ['set filter label on its wash over the ground', '--set-label', '--set-fill', '--ground', 4.5],
    ['set filter label on its wash over a surface', '--set-label', '--set-fill', '--surface', 4.5],
    [
      'set filter label on its hover over a surface',
      '--set-label',
      '--set-fill-hover',
      '--surface',
      4.5,
    ],
    // A chosen item's label and glyph, such as the current tab and a checked box, on its wash.
    ['chosen label on its wash over the ground', '--chosen-label', '--wash', '--ground', 4.5],
    ['chosen label on its wash over a surface', '--chosen-label', '--wash', '--surface', 4.5],
    ['chosen glyph on its wash over a surface', '--accent', '--wash', '--surface', 3],
    // A plain worded button's accent label under the pointer.
    ['plain button label on its hover over the ground', '--accent', '--tint', '--ground', 4.5],
    ['plain button label on its hover over a surface', '--accent', '--tint', '--surface', 4.5],
    ...(['--danger', '--warning'] as const).flatMap(
      (tone): [string, string, string, string, number][] =>
        (['--ground', '--surface'] as const).map((ground) => [
          `${tone} label on a selected row over ${ground}`,
          tone,
          '--wash',
          ground,
          4.5,
        ]),
    ),
    ...(['--row-hover', '--wash', '--play-wash', '--set-fill', '--tint'] as const).flatMap(
      (wash): [string, string, string, string, number][] =>
        (['--ground', '--surface'] as const).map((ground) => [
          `unknown ring on ${wash} over ${ground}`,
          '--unknown-on-surface',
          wash,
          ground,
          3,
        ]),
    ),
  ])('%s passes', (_, ink, wash, ground, min) => {
    expect(ratio(token(ink), washOver(values, wash, token(ground)))).toBeGreaterThanOrEqual(min)
  })

  // A destructive or warning Button's hover is its own tone at 15% (Button.tsx).
  it.each(
    (['--danger', '--warning'] as const).flatMap((tone) =>
      (['--ground', '--surface'] as const).map((ground) => [tone, ground] as const),
    ),
  )('%s label on its hover over %s passes', (tone, ground) => {
    expect(ratio(token(tone), over(token(tone), 0.15, token(ground)))).toBeGreaterThanOrEqual(4.5)
  })
})
