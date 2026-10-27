// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'

// Every color a component paints comes from a role in tokens.css, so a new palette changes one
// file. These are the places that may still hold a color value, each with its reason.
const ALLOWED: Record<string, string> = {
  'theme/tokens.css': 'the palette',
  'theme/tokens.ts': 'the palette, mirrored for the contrast tests',
  'theme/shape.css': 'shadows, which mix black and white at fixed strengths',
  'theme/practiceTheme.css': 'mixes that must follow the roles practice redeclares',
  'features/tuner/blend.ts': 'an animated blend between two tokens',
  'features/tuner/TunerBars.tsx': 'an animated blend between two tokens',
  'ui/sheetGeometry.ts': "the scrim's animated strength",
  'features/scans/prepareImage.ts': 'image data, not interface',
  'fixture/seed.ts': 'image data, not interface',
  'app/welcome/slideArt.tsx': 'the welcome illustrations draw their own pictures',
}

const PRIMITIVE =
  /--(?:white|black|(?:warm-)?gray-\d+|slate-\d+|blue-\d+|coral-\d+|red-\d+|green-\d+|orange-\d+)\b/
const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(|color-mix\(/i
// A Tailwind color utility with an opacity modifier, such as bg-text-primary/70.
const OPACITY_MODIFIER =
  /\b(?:bg|text|border|ring|outline|fill|stroke|divide|decoration|from|to|via)-(?:[a-z]+-)*[a-z]+\/\d{1,3}\b/

const root = new URL('..', import.meta.url).pathname
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

// Test helpers measure colors; they never paint one.
const files = sources(root)
  .map((path) => relative(root, path))
  .filter((file) => !file.startsWith('test/'))

it.each(files.filter((file) => !(file in ALLOWED)))('%s names only roles', (file) => {
  const lines = readFileSync(join(root, file), 'utf8').split('\n')
  const found = lines.flatMap((line, index) => {
    // Comments describe colors; only code paints them.
    const code = line.replace(/\/\/.*$|\/\*.*?\*\/|^\s*\*.*$/g, '')
    const hit = [PRIMITIVE, LITERAL, OPACITY_MODIFIER].map((pattern) => pattern.exec(code)?.[0])
    return hit.some(Boolean) ? [`${index + 1}: ${hit.filter(Boolean).join(', ')}`] : []
  })
  expect(found).toEqual([])
})

it('allows only files that exist', () => {
  for (const file of Object.keys(ALLOWED)) expect(files).toContain(file)
})
