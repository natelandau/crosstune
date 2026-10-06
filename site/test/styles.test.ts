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

const token = (name: string) => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens)
  if (!match) throw new Error(`no --${name} token`)
  return match[1]
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
  it.each(['.nav-actions .button', '.nav a:not(.lockup, .button)', '.text-link', '.footer a'])(
    'gives %s a hit area at least 44px tall',
    (selector) => {
      const heights = declared(base, selector, 'min-height').map((v) => Number.parseFloat(v))
      expect(heights.length, selector).toBeGreaterThan(0)
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(44)
    },
  )
})

describe('source-less clips', () => {
  const selector = '.poster + video.capture:not([src])'

  it('hide the empty player without leaving the accessibility tree', () => {
    expect(declared(base, selector, 'opacity')).toEqual(['0'])
    expect(declared(base, selector, 'visibility')).toEqual([])
    expect(declared(base, selector, 'display')).toEqual([])
  })
})

/** The `@media (scripting: enabled)` block of `css`, where pinning applies. */
function scripted(css: string): string {
  const start = css.indexOf('@media (scripting: enabled)')
  if (start < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1)
  }
  return ''
}

describe('runways', () => {
  const pinning = scripted(base)

  it.each([1, 2, 3, 5])(
    "are the pinned block's height plus one step per extra clip, for %i clips",
    (n) => {
      const [step] = declared(pinning, '.runway', '--step')
      const [height] = declared(pinning, '.runway', 'height')
      expect(step).toBe('70vh')
      // Evaluated for a 600px block in a 1000px viewport.
      const expr = height
        .replace(/^calc/, '')
        .replace(/var\(--pinned-h,\s*100svh\)/, '600')
        .replaceAll('var(--n)', String(n))
        .replaceAll('var(--step)', step)
        .replace(/(\d+)vh/g, '($1 * 10)')
      expect(expr).toMatch(/^[\d\s()+*-]+$/)
      expect(Function(`return ${expr}`)()).toBe(600 + (n - 1) * 700)
    },
  )

  it("lets the pinned block keep its content's height", () => {
    expect(declared(pinning, '.pinned', 'height')).toEqual([])
  })

  it('pin only when a script can drive them, with no snap points otherwise', () => {
    expect(declared(base, '.snap', 'display')).toEqual(['none', 'block'])
    expect(declared(pinning, '.snap', 'display')).toEqual(['block'])
    expect(declared(pinning, '.pinned', 'position')).toEqual(['sticky'])
    expect(declared(base.replace(pinning, ''), '.runway', 'height')).toEqual([])
  })
})

describe('root snapping', () => {
  it('applies only while a runway sets data-snap, and never with reduced motion', () => {
    expect(declared(base, 'html', 'scroll-snap-type')).toEqual([])
    const [motion] = mediaBlocks(base, '@media (prefers-reduced-motion: no-preference)')
    expect(declared(motion.text, 'html[data-snap]', 'scroll-snap-type')).toEqual(['y proximity'])
    expect(declared(base.replace(motion.text, ''), 'html[data-snap]', 'scroll-snap-type')).toEqual(
      [],
    )
  })
})

describe('pinned hero', () => {
  const hero = read('components/Hero.astro')
  const px = (values: string[]) => Number.parseFloat(values[0])

  it('leaves the phone room for the gap and two rows of controls, if they wrap', () => {
    const room = px(declared(hero, '.stage', '--controls-room'))
    const gap = px(declared(hero, '.stage', 'gap'))
    const tabs =
      px(declared(hero, '.seg button', 'min-height')) + 2 * px(declared(hero, '.seg', 'padding'))
    const toggle = px(declared(base, '.clip-toggle', 'min-height'))
    const rowGap = px(declared(hero, '.controls', 'gap'))
    expect(room).toBeGreaterThanOrEqual(gap + tabs + rowGap + toggle)
  })

  // At rest the phone reads as part of the hero, just under its text, not centered in its pinned
  // screen.
  it('sits the phone a short gap under the hero text, closer on a phone', () => {
    expect(declared(hero, '.stage', 'align-content')).toEqual(['start'])
    expect(declared(hero, '.stage', 'padding-top')).toEqual(['var(--stage-top)'])
    expect(declared(scripted(hero), '.stage', 'padding-top')).toEqual([])
    const [desktop, phone] = declared(hero, '.stage', '--stage-top').map((v) => px([v]))
    expect(desktop).toBeGreaterThanOrEqual(32)
    expect(desktop).toBeLessThanOrEqual(48)
    expect(phone).toBeLessThan(desktop)
  })

  it('caps the phone by the room the top gap and the controls leave in the pinned screen', () => {
    const caps = declared(hero, '.stage :global(.stack)', 'width')
    expect(caps.length).toBeGreaterThan(0)
    for (const cap of caps) {
      expect(cap).toContain('100svh - var(--controls-room) - var(--stage-top)')
    }
  })
})

/** Every `@media <query>` block of `css`, with where each starts. */
function mediaBlocks(css: string, query: string): Array<{ start: number; text: string }> {
  const out = []
  for (let start = css.indexOf(query); start >= 0; start = css.indexOf(query, start + 1)) {
    let depth = 0
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++
      if (css[i] === '}' && --depth === 0) {
        out.push({ start, text: css.slice(start, i + 1) })
        break
      }
    }
  }
  return out
}

describe('reduced motion in the feature sections', () => {
  const css = read('components/FeatureScroller.astro')
  const reduced = mediaBlocks(css, '@media (prefers-reduced-motion: reduce)')

  // Equal-specificity rules resolve by source order, so the override must come after every
  // transition it cancels, including those inside width media blocks.
  it('turns off every transition with a rule that comes after it', () => {
    const transitions = [...css.matchAll(/([^{}]+)\{([^{}]*transition:\s*(?!none)[^;]+;[^{}]*)\}/g)]
    expect(transitions.length).toBeGreaterThan(0)
    for (const match of transitions) {
      const at = match.index!
      if (reduced.some((block) => at > block.start && at < block.start + block.text.length))
        continue
      for (const selector of selectorList(match[1].replace(/^[\s\S]*\}/, ''))) {
        const later = reduced.filter((block) => block.start > at)
        const cancelled = later.some((block) =>
          declared(block.text.replace(/^[^{]*\{/, ''), selector, 'transition').includes('none'),
        )
        expect(cancelled, selector).toBe(true)
      }
    }
  })
})

describe('section spacing', () => {
  // Only the styles, so a component's first rule is not read with its markup as the selector.
  const styles = (name: string) => read(`components/${name}.astro`).replace(/^[\s\S]*<style>/, '')
  const pad = (css: string) => Number.parseFloat(declared(css, ':root', '--section-pad')[0])
  const phone = mediaBlocks(tokens, '@media (max-width: 600px)')
    .map((block) => block.text)
    .join('\n')

  // Two sections' paddings meet between them, and that band is the most empty space the page
  // shows: 168px on a wide screen, 136px on a phone.
  it('keeps the space between two sections within normal spacing', () => {
    expect(2 * pad(tokens)).toBeLessThanOrEqual(168)
    expect(2 * pad(phone.replace(/^[^{]*\{/, ''))).toBeLessThanOrEqual(136)
  })

  it.each([
    ['Problem', '.problem'],
    ['Pricing', '.pricing'],
    ['MakerNote', '.note'],
    ['Faq', '.faq'],
    ['Closing', '.closing'],
  ])('pads %s by the shared section space', (name, selector) => {
    const css = styles(name)
    expect(declared(css, selector, 'padding-block'), name).toEqual(['var(--section-pad)'])
  })

  it('pads the feature sections by the shared section space, at every width', () => {
    const css = styles('FeatureScroller')
    expect(declared(css, '.features', 'padding-block')).toEqual(['var(--section-pad)'])
    expect(declared(css, '.features', 'padding-top')).toEqual([])
    expect(declared(css, '.features', 'padding-bottom')).toEqual([])
  })

  it('ends the hero with the shared section space, at every width', () => {
    const css = styles('Hero')
    expect(declared(css, '.hero', 'padding-block')).toEqual(['16px var(--section-pad)'])
    expect(declared(css, '.hero', 'padding-bottom')).toEqual([])
  })

  // Centering a short section's text in a screen-tall step leaves a band above and below it.
  it('top-aligns the single-capture sections, with no screen-tall minimum', () => {
    const css = styles('FeatureScroller')
    expect(declared(css, '.step', 'min-height')).toEqual([])
    expect(declared(css, '.step', 'align-content')).toEqual(['start'])
    expect(declared(css, '.stage', 'height')).toEqual([])
  })
})

describe('single-capture sections on desktop', () => {
  const css = read('components/FeatureScroller.astro').replace(/^[\s\S]*<style>/, '')
  const desktop = mediaBlocks(css, '@media (min-width: 900px)')
    .map((block) => block.text.replace(/^[^{]*\{/, ''))
    .join('\n')
  const px = (values: string[]) => Number.parseFloat(values[0])

  // A pinned section's bottom padding and the run's top padding meet before its first heading.
  it('start a run after a pinned section at the same spacing as between their own sections', () => {
    const gap = px(declared(desktop, '.steps', 'gap'))
    const pinnedBottom = px(declared(desktop, '.bulleted .pinned', 'padding-block'))
    const runTop = px(declared(desktop, '.scroller', 'padding-top'))
    expect(pinnedBottom + runTop).toBe(gap)
  })

  // The stage is sticky within its run, so a last section shorter than the stage would carry
  // the phone off screen while it is still being read.
  it('keep the stage pinned through the last section of a run', () => {
    expect(declared(desktop, '.step:last-child', 'min-height')).toEqual(['var(--stage-h)'])
    expect(declared(desktop, '.stage', 'top')[0]).toContain('var(--stage-h)')
  })
})

describe('pinned sections on a short screen', () => {
  const css = read('components/FeatureScroller.astro').replace(/^[\s\S]*<style>/, '')
  const short = mediaBlocks(css, '@media (min-width: 900px) and (max-height: 680px)')
    .map((block) => block.text.replace(/^[^{]*\{/, ''))
    .join('\n')

  // The phone shrinks with the screen's height on its own; the copy needs this to stay in view.
  it('tightens the copy so the pinned block fits', () => {
    expect(Number.parseFloat(declared(short, '.bulleted h3', 'font-size')[0])).toBeLessThan(52)
    expect(declared(short, '.point', 'padding-block')).toEqual(['4px'])
    expect(declared(short, '.points', 'max-width')).toHaveLength(1)
  })
})

describe('feature sections on a phone', () => {
  const css = read('components/FeatureScroller.astro').replace(/^[\s\S]*<style>/, '')
  const narrow = mediaBlocks(css, '@media (max-width: 899.98px)')
    .map((block) => block.text.replace(/^[^{]*\{/, ''))
    .join('\n')

  it.each(['.step', '.anywhere'])('start %s at least 80px after the section before', (selector) => {
    const top = Number.parseFloat(declared(narrow, selector, 'padding-top')[0])
    expect(top).toBeGreaterThanOrEqual(80)
  })
})

describe('phones on a phone', () => {
  const css = read('components/FeatureScroller.astro').replace(/^[\s\S]*<style>/, '')
  const narrow = mediaBlocks(css, '@media (max-width: 899.98px)')
    .map((block) => block.text.replace(/^[^{]*\{/, ''))
    .join('\n')
  const rules = [...narrow.matchAll(/([^{}]+)\{([^{}]*)\}/g)]

  // Every block that applies below the desktop width, not only the one at the breakpoint.
  const phoneRules = [...new Set(css.match(/@media \(max-width: [\d.]+px\)/g))]
    .flatMap((query) => mediaBlocks(css, query))
    .flatMap((block) => [...block.text.replace(/^[^{]*\{/, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)])

  // The phone sits on the page with its own shadow, in a carousel card and in a single-capture
  // section alike.
  it('puts no panel behind a feature phone', () => {
    expect(phoneRules.length).toBeGreaterThan(rules.length)
    const panelRules = phoneRules.filter(([, selectors]) => /\.panel|\.card/.test(selectors))
    expect(panelRules.length).toBeGreaterThan(0)
    for (const [, selectors, body] of panelRules) {
      expect(body, selectors.trim()).not.toMatch(/background|border-radius|overflow/)
    }
    expect(css).not.toMatch(/var\(--alabaster\)/)
  })

  it('sizes single-capture phones like the carousel phones', () => {
    for (const selector of ['.card :global(.phone)', '.step .panel :global(.phone)']) {
      expect(declared(narrow, selector, 'width'), selector).toEqual(['min(86%, 25vh)'])
    }
  })
})
