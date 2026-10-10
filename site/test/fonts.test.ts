import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { FONT_CHARS } from '../src/styles/fontChars'

const dist = resolve(import.meta.dirname, '../dist')

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return htmlFiles(path)
    return name.endsWith('.html') ? [path] : []
  })
}

describe('subset fonts', () => {
  it.each(htmlFiles(dist).map((file) => file.slice(dist.length)))(
    '%s uses only characters the subsets keep',
    (file) => {
      const doc = new JSDOM(readFileSync(join(dist, file), 'utf8')).window.document
      for (const el of doc.querySelectorAll('script, style')) el.remove()
      const shown = [
        doc.body.textContent ?? '',
        ...[...doc.querySelectorAll('[placeholder]')].map((el) => el.getAttribute('placeholder')),
      ].join('')
      const missing = new Set([...shown].filter((c) => !/\s/.test(c) && !FONT_CHARS.includes(c)))
      expect([...missing]).toEqual([])
    },
  )
})
