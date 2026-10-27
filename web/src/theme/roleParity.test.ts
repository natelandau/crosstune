// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// Web and Apple name every role alike: kebab-case here, camelCase on Apple. A role one platform
// lacks is listed below with its reason, so a role added to one platform alone fails this test.
const WEB_ONLY: Record<string, string> = {
  'surface-raised-hover': 'a pointer hover the web draws itself',
  'text-tertiary-hover': 'a pointer hover the web draws itself',
  'accent-fill-hover': 'a pointer hover the web draws itself',
  'accent-track-hover': 'a pointer hover the web draws itself',
  'danger-hover': 'a pointer hover the web draws itself',
  'warning-fill-hover': 'a pointer hover the web draws itself',
  'record-hover': 'a pointer hover the web draws itself',
  'status-known-subtle-hover': 'a pointer hover the web draws itself',
  'status-learning-subtle-hover': 'a pointer hover the web draws itself',
  'status-unknown-subtle-hover': 'a pointer hover the web draws itself',
  'on-practice-hover': 'a pointer hover the web draws itself',
  'practice-fill-hover': 'a pointer hover the web draws itself',
  'practice-hover': 'a pointer hover the web draws itself',
  'danger-subtle': 'Apple reads it as Palette.subtle(.danger)',
  'warning-subtle': 'Apple reads it as Palette.subtle(.warning)',
  'status-known-subtle': 'the status segmented control is web only',
  'status-learning-subtle': 'the status segmented control is web only',
  'status-unknown-subtle': 'the status segmented control is web only',
  'field-border': 'the CSS scope that gives a field on a surface its edge',
  'waveform-played': 'the CSS scope that redraws a waveform inside practice',
  'waveform-unplayed': 'the CSS scope that redraws a waveform inside practice',
  scrim: "Apple's system sheets draw their own",
  handle: "Apple's system sheets draw their own grabber",
  'device-bezel': 'the web welcome illustrations',
  'illustration-practice-background': 'the web welcome illustrations',
}
const APPLE_ONLY: Record<string, string> = {
  accentSelection: "UIKit's list selection, which the web draws as a tint",
  groupedBackground: "iOS's grouped form",
  groupedSurface: "iOS's grouped form",
  neutralFill: 'a swipe action under the white label SwiftUI draws',
  onTintSecondary: "the Plan sheet card, where Apple's secondary text falls short",
}

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')))
const PRIMITIVE =
  /^(?:white|black|(?:warm-)?gray-\d+|slate-\d+|blue-\d+|coral-\d+|red-\d+|green-\d+|orange-\d+)$/
const DATA = /^(?:key|loop|heatmap)-/
const webRoles = [...rootBlock.matchAll(/\n {2}--([\w-]+):/g)]
  .map((match) => match[1]!)
  .filter((name) => !PRIMITIVE.test(name) && !DATA.test(name))

const styleDir = new URL(
  '../../../apple/CrosstuneKit/Sources/CrosstuneDesign/Style/',
  import.meta.url,
)
const swift = readdirSync(styleDir)
  .filter((name) => name.endsWith('.swift'))
  .map((name) => readFileSync(new URL(name, styleDir), 'utf8'))
  .join('\n')
const appleDeclared = new Set(
  [...swift.matchAll(/static (?:let|var|func) (\w+)/g)].map((m) => m[1]!),
)
const tokenCases = [
  ...(/enum Token[^{]*\{([\s\S]*?)\n {4}\}/.exec(swift)?.[1] ?? '').matchAll(/\b([a-z]\w*)\b/g),
]
  .map((match) => match[1]!)
  .filter((name) => name !== 'case')
const appleRoles = new Set([...appleDeclared, ...tokenCases])

const camel = (kebab: string) =>
  kebab.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())

it('finds roles on both platforms', () => {
  expect(webRoles.length).toBeGreaterThan(20)
  expect(tokenCases.length).toBeGreaterThan(20)
})

it.each(webRoles.filter((role) => !(role in WEB_ONLY)))('names web role %s on Apple', (role) => {
  expect(appleRoles).toContain(camel(role))
})

it.each(tokenCases.filter((role) => !(role in APPLE_ONLY)))(
  'names Apple role %s on the web',
  (role) => {
    expect(webRoles.map(camel)).toContain(role)
  },
)

it('lists only platform-only roles that one platform still lacks', () => {
  for (const role of Object.keys(WEB_ONLY)) {
    expect(webRoles).toContain(role)
    expect(appleRoles).not.toContain(camel(role))
  }
  for (const role of Object.keys(APPLE_ONLY)) {
    expect(tokenCases).toContain(role)
    expect(webRoles.map(camel)).not.toContain(role)
  }
})
