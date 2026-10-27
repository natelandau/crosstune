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
  const backgrounds = [
    ['the page', p.pageBackground],
    ['surface', p.surface],
    ['field', p.field],
    ['surface-raised', p.surfaceRaised],
  ] as const
  const cases: Case[] = [
    ...backgrounds.flatMap(([name, bg]): Case[] => [
      [`primary text on ${name}`, p.textPrimary, bg, 4.5],
      [`secondary text on ${name}`, p.textSecondary, bg, 4.5],
      [`accent on ${name}`, p.accent, bg, 4.5],
    ]),
    ['tertiary text on the page', p.textTertiary, p.pageBackground, 3],
    ['label on the accent fill', p.onAccentFill, p.accentFill, 4.5],
    ['the mark on the page', p.brandSecondary, p.pageBackground, 3],
    ['label on brand', p.onBrand, p.brand, 4.5],
    ['label on jet', p.onJet, p.jet, 4.5],
    ['absence mark on a card', p.glyphFaint, p.surface, 3],
    ['absence mark on the page', p.glyphFaint, p.pageBackground, 3],
    ...(['pageBackground', 'surface'] as const).flatMap((name): Case[] => [
      [`known glyph on ${name}`, p.statusKnown, p[name], 3],
      [`record on ${name}`, p.record, p[name], 3],
    ]),
    ['unknown ring on the page', p.statusUnknown, p.pageBackground, 3],
    ['unknown ring on a surface', p.statusUnknownOnFill, p.surface, 3],
    ...backgrounds.flatMap(([name, bg]): Case[] => [
      [`danger label on ${name}`, p.danger, bg, 4.5],
      [`warning label on ${name}`, p.warning, bg, 4.5],
    ]),
    ['label on danger', p.onStatus, p.danger, 4.5],
    ['label on the record fill', p.onRecord, p.record, 4.5],
    ['label on the record fill under the pointer', p.onRecord, p.recordHover, 4.5],
    ['label on the warning fill', p.onWarningFill, p.warningFill, 4.5],
    ...backgrounds
      .filter(([name]) => name !== 'field')
      .flatMap(([name, bg]): Case[] => [
        [`switch track off on ${name}`, p.textTertiary, bg, 3],
        [`switch track on on ${name}`, p.accentTrack, bg, 3],
      ]),
    ['switch thumb on the track off', p.onAccentFill, p.textTertiary, 3],
    ['switch thumb on the track on', p.onAccentFill, p.accentTrack, 3],
    ['label on a disabled fill', p.disabledInk, p.disabledFill, 4.5],
    // Off, a filled control still contrasts with what it sits on.
    ['disabled fill on the page', p.disabledFill, p.pageBackground, 1.2],
    ['disabled fill on a surface', p.disabledFill, p.surface, 1.2],
  ]
  it.each(cases)('%s passes', (_, fg, bg, min) => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min))
})

// Learning is Apple's system orange, below 3:1 on a light page; its half fill carries the status.
it.each([
  ['light', '#FF8D28'],
  ['dark', '#FF9230'],
] as const)("draws learning in Apple's %s orange", (scheme, orange) => {
  expect(PALETTE[scheme].statusLearning).toBe(orange)
})

it.each(['light', 'dark'] as const)(
  'draws %s tertiary text fainter than secondary text',
  (scheme) => {
    const p = PALETTE[scheme]
    expect(ratio(p.textTertiary, p.pageBackground)).toBeLessThan(
      ratio(p.textSecondary, p.pageBackground),
    )
  },
)

// Read from disk: the unit project hands CSS imports, raw ones included, over empty.
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const practiceTheme = readFileSync(new URL('./practiceTheme.css', import.meta.url), 'utf8')

/** The custom properties a block of CSS sets, by name. */
function declared(selector: string, source = css): Map<string, string> {
  const start = source.indexOf(`${selector} {`)
  const body = source.slice(start, source.indexOf('\n}', start))
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

type Rgba = [number, number, number, number]

/** A hex or rgba() color as channels 0 to 255 and an alpha 0 to 1. */
function parse(color: string): Rgba {
  if (color.startsWith('#')) {
    const n = Number.parseInt(color.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]
  }
  const match = /^rgba?\(([^)]+)\)$/.exec(color.replace(/\s+/g, ''))
  if (!match) throw new Error(`${color} is not a hex or rgba() color`)
  const [r, g, b, a = '1'] = match[1]!.split(',')
  return [Number(r), Number(g), Number(b), Number(a)]
}

/** Channels and alpha back to hex when opaque, rgba() when not. */
function format([r, g, b, a]: Rgba): string {
  const channels = [r, g, b].map((c) => Math.round(c))
  if (a >= 1) return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`
  return `rgba(${channels.join(',')},${Math.round(a * 1000) / 1000})`
}

/** `color-mix(in srgb, …)` as the browser computes it: premultiplied by alpha. */
function mix(a: string, aShare: number, b: string): string {
  const [x, y] = [parse(a), parse(b)]
  const alpha = x[3] * aShare + y[3] * (1 - aShare)
  if (alpha === 0) return 'rgba(0,0,0,0)'
  const channel = (i: number) => (x[i]! * x[3] * aShare + y[i]! * y[3] * (1 - aShare)) / alpha
  return format([channel(0), channel(1), channel(2), alpha])
}

/** Every token a scheme sets, each resolved to a hex or rgba() color where it is one. */
function tokens(
  scheme: 'light' | 'dark',
  extra: Map<string, string> = new Map(),
): Map<string, string> {
  const light = declared(':root')
  const set = new Map([
    ...light,
    ...(scheme === 'dark' ? declared(":root[data-scheme='dark']") : []),
    ...extra,
  ])
  const resolve = (value: string): string => {
    const v = value.trim()
    if (v === 'transparent') return 'rgba(0,0,0,0)'
    const ref = /^var\((--[\w-]+)\)$/.exec(v)?.[1]
    if (ref !== undefined) {
      const named = set.get(ref)
      return named === undefined ? v : resolve(named)
    }
    const mixed = /^color-mix\(in srgb, (.+?)(?: (\d+)%)?, (.+?)(?: (\d+)%)?\)$/.exec(v)
    if (mixed) {
      const [, a, aPct, b, bPct] = mixed
      const share =
        aPct !== undefined ? Number(aPct) / 100 : bPct !== undefined ? 1 - Number(bPct) / 100 : 0.5
      return mix(resolve(a!), share, resolve(b!))
    }
    return v
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
  const token = (name: string) => normal(values.get(name) ?? 'missing')

  it.each(KEY_COLORS[scheme].map((colors, pitch) => [pitch, colors] as const))(
    'matches tokens.ts for key %i',
    (pitch, { background, text, selectedBackground, selectedText }) => {
      expect(token(`--key-${pitch}-background`)).toBe(normal(background))
      expect(token(`--key-${pitch}-text`)).toBe(normal(text))
      expect(token(`--key-${pitch}-selected-background`)).toBe(normal(selectedBackground))
      expect(token(`--key-${pitch}-selected-text`)).toBe(normal(selectedText))
    },
  )

  it.each(KEY_COLORS[scheme].map((colors, pitch) => [pitch, colors] as const))(
    'keeps key %i legible at rest and selected',
    (_, { background, text, selectedBackground, selectedText }) => {
      expect(ratio(text, background)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(selectedText, selectedBackground)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(LOOP_COLORS[scheme].map((color, slot) => [slot, color] as const))(
    'matches tokens.ts for loop %i, its tint, and keeps its white label legible',
    (slot, color) => {
      expect(token(`--loop-${slot}`)).toBe(normal(color))
      const tint = token(`--loop-${slot}-tint`)
      expect(tint.startsWith(`rgba(${rgb(color).slice(4, -1).replace(/\s/g, '')},`)).toBe(true)
      expect(ratio('#FFFFFF', color)).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(HEAT_STEPS[scheme].map((color, step) => [step + 1, color] as const))(
    'matches tokens.ts for heatmap step %i and reads against the page',
    (step, color) => {
      expect(token(`--heatmap-${step}`)).toBe(normal(color))
      expect(ratio(color, PALETTE[scheme].pageBackground)).toBeGreaterThanOrEqual(3)
    },
  )
})

/** Every token inside practice in a scheme, with practiceTheme.css's redeclarations applied. */
const practiceTokens = (scheme: 'light' | 'dark') =>
  tokens(scheme, declared('[data-practice]', practiceTheme))

describe.each(['light', 'dark'] as const)("practice's background in %s", (scheme) => {
  const values = practiceTokens(scheme)
  const background = values.get('--practice-background')!

  it('keeps white, the accent, the secondary text, and the brand playhead legible', () => {
    expect(ratio(values.get('--on-practice')!, background)).toBeGreaterThanOrEqual(4.5)
    // Practice draws the dark scheme's accent in either appearance, as text and glyphs.
    expect(normal(values.get('--accent')!)).toBe(normal(PALETTE.dark.accent))
    expect(ratio(values.get('--accent')!, background)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(values.get('--on-practice-secondary')!, background)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(values.get('--brand')!, background)).toBeGreaterThanOrEqual(3)
  })

  it("draws the dark scheme's danger in either appearance", () => {
    expect(normal(values.get('--danger')!)).toBe(normal(PALETTE.dark.danger))
  })

  // Practice draws the dark scheme's loops, each under its white name tab.
  it.each(LOOP_COLORS.dark.map((color, slot) => [slot, color] as const))(
    'draws loop %i legibly, under a legible name',
    (slot, color) => {
      expect(normal(values.get(`--loop-${slot}`)!)).toBe(normal(color))
      expect(ratio(color, background)).toBeGreaterThanOrEqual(3)
      expect(ratio('#FFFFFF', color)).toBeGreaterThanOrEqual(4.5)
    },
  )

  // The tuner's two off-pitch steps: both legible, and apart in lightness as well as hue, so
  // they stay apart under red-green color blindness.
  it('keeps the tuner steps legible and apart', () => {
    const p = PALETTE[scheme]
    expect(ratio(p.tunerClose, background)).toBeGreaterThanOrEqual(3)
    expect(ratio(p.brand, background)).toBeGreaterThanOrEqual(3)
    const gap = relativeLuminance(rgb(p.tunerClose)) - relativeLuminance(rgb(p.brand))
    expect(Math.abs(gap)).toBeGreaterThanOrEqual(0.1)
  })

  // Inside the target zone the bars blend from the close step to green; every color between
  // stays legible.
  it('keeps the tuner bars legible across the blend', () => {
    const p = PALETTE[scheme]
    for (let step = 0; step <= 10; step++) {
      const share = step / 10
      const blended = mix(p.tunerInTune, share, p.tunerClose)
      expect(ratio(blended, background), `${share} green`).toBeGreaterThanOrEqual(3)
    }
  })

  // The in-tune background replaces practice's under the tuner's white type and green bars.
  it('keeps white type and the green bars legible on the in-tune background', () => {
    const inTune = values.get('--tuner-in-tune-background')!
    expect(ratio(values.get('--on-practice')!, inTune)).toBeGreaterThanOrEqual(4.5)
    expect(ratio(values.get('--tuner-in-tune')!, inTune)).toBeGreaterThanOrEqual(3)
    expect(inTune).not.toBe(background)
  })
})

it('redeclares every loop color for practice', () => {
  for (let slot = 0; slot < LOOP_COLORS.dark.length; slot++) {
    expect(practiceTheme).toContain(`--loop-${slot}: var(--loop-${slot}-dark);`)
    expect(practiceTheme).toContain(`--loop-${slot}-tint: var(--loop-${slot}-tint-dark);`)
  }
})

/** `color`, possibly translucent, painted over an opaque background. */
function over(color: string, background: string): string {
  const [r, g, b, a] = parse(color)
  const under = parse(background)
  return format([
    r * a + under[0] * (1 - a),
    g * a + under[1] * (1 - a),
    b * a + under[2] * (1 - a),
    1,
  ])
}

describe.each(['light', 'dark'] as const)('tints in %s', (scheme) => {
  const values = tokens(scheme)
  const token = (name: string) => values.get(name)!
  it.each([
    // The comparison's Premium column: the tint over the card it sits on.
    ['Premium value on its tint', '--on-tint', '--premium-wash', '--surface', 4.5],
    ['Premium check on its tint', '--text-primary', '--premium-wash', '--surface', 3],
    // A feature's icon tile, on the card its row sits on.
    ['feature icon on its tile', '--text-secondary', '--tint', '--surface', 3],
    [
      'trial card secondary text on its tint',
      '--text-secondary',
      '--tint',
      '--page-background',
      4.5,
    ],
    ['trial card text on its tint', '--text-primary', '--tint', '--page-background', 4.5],
    ['secondary text on a selected row', '--text-secondary', '--wash', '--page-background', 4.5],
    // A dimmed row, such as an archived tune, under each tint a row takes.
    ...(['--row-hover', '--wash', '--play-wash'] as const).flatMap(
      (tint): [string, string, string, string, number][] => [
        [`dimmed text on ${tint}`, '--text-secondary', tint, '--page-background', 4.5],
        [`tertiary text on ${tint}`, '--text-tertiary', tint, '--page-background', 3],
      ],
    ),
    ['primary text on a set filter', '--text-primary', '--set-fill', '--page-background', 4.5],
    ['secondary text on a set filter', '--text-secondary', '--set-fill', '--page-background', 4.5],
    [
      'set filter label on its tint over the page',
      '--on-tint',
      '--set-fill',
      '--page-background',
      4.5,
    ],
    ['set filter label on its tint over a surface', '--on-tint', '--set-fill', '--surface', 4.5],
    [
      'set filter label on its hover over a surface',
      '--on-tint',
      '--set-fill-hover',
      '--surface',
      4.5,
    ],
    // A chosen item's label and glyph, such as the current tab and a checked box, on its tint.
    ['chosen label on its tint over the page', '--on-tint', '--wash', '--page-background', 4.5],
    ['chosen label on its tint over a surface', '--on-tint', '--wash', '--surface', 4.5],
    ['chosen glyph on its tint over a surface', '--accent', '--wash', '--surface', 3],
    // A plain worded button's accent label under the pointer.
    [
      'plain button label on its hover over the page',
      '--accent',
      '--tint',
      '--page-background',
      4.5,
    ],
    ['plain button label on its hover over a surface', '--accent', '--tint', '--surface', 4.5],
    ...(['--danger', '--warning'] as const).flatMap(
      (tone): [string, string, string, string, number][] =>
        (['--page-background', '--surface'] as const).flatMap((background) => [
          [`${tone} label on a selected row over ${background}`, tone, '--wash', background, 4.5],
          [
            `${tone} label on its hover over ${background}`,
            tone,
            `${tone}-subtle`,
            background,
            4.5,
          ],
        ]),
    ),
    ...(['--row-hover', '--wash', '--play-wash', '--set-fill', '--tint'] as const).flatMap(
      (tint): [string, string, string, string, number][] =>
        (['--page-background', '--surface'] as const).map((background) => [
          `unknown ring on ${tint} over ${background}`,
          '--status-unknown-on-fill',
          tint,
          background,
          3,
        ]),
    ),
  ])('%s passes', (_, fg, tint, background, min) => {
    const under = over(token(tint), token(background))
    expect(ratio(over(token(fg), under), under)).toBeGreaterThanOrEqual(min)
  })
})
