import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FONT_CHARS } from '../src/styles/fontChars'
import { dist, htmlFiles, parseHtml } from './dist'

describe('subset fonts', () => {
  it.each(htmlFiles().map((file) => file.slice(dist.length)))(
    '%s uses only characters the subsets keep',
    (file) => {
      const doc = parseHtml(readFileSync(join(dist, file), 'utf8'))
      for (const el of doc.querySelectorAll('script, style')) el.remove()
      const shown = [
        doc.body.textContent ?? '',
        ...[...doc.querySelectorAll('[placeholder]')].map((el) => el.getAttribute('placeholder')),
      ].join('')
      const missing = new Set([...shown].filter((c) => !/\s/.test(c) && !FONT_CHARS.includes(c)))
      expect([...missing]).toEqual([])
    },
  )

  // Demo scripts write text after load, which the built pages never show.
  it('keeps every character the demo scripts write', () => {
    const demos = resolve(import.meta.dirname, '../src/demos')
    const source = readdirSync(demos)
      .map((name) => readFileSync(join(demos, name), 'utf8'))
      .join('')
    const missing = new Set([...source].filter((c) => !/\s/.test(c) && !FONT_CHARS.includes(c)))
    expect([...missing]).toEqual([])
  })
})
