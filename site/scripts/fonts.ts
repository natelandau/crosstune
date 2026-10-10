// Writes the site's subset fonts to src/assets/fonts. Run through `just fonts` after a font
// package update or a change to FONT_CHARS; the output is committed.
import { readFile, writeFile } from 'node:fs/promises'
import subsetFont from 'subset-font'
import { FONT_CHARS } from '../src/styles/fontChars.ts'

const FONTS = [
  [
    '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2',
    'schibsted-grotesk.woff2',
  ],
  ['@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', 'geist.woff2'],
  ['@fontsource/caveat/files/caveat-latin-500-normal.woff2', 'caveat.woff2'],
]

for (const [source, name] of FONTS) {
  const input = await readFile(new URL(`../node_modules/${source}`, import.meta.url))
  const output = await subsetFont(input, FONT_CHARS, { targetFormat: 'woff2' })
  await writeFile(new URL(`../src/assets/fonts/${name}`, import.meta.url), output)
  console.log(`${name}: ${input.length} -> ${output.length} bytes`)
}
