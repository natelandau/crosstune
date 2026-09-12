import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Parse the Pages `_headers` format: an unindented URL line followed by indented `Name: value` lines. */
function rulesFor(url: string): string[] {
  const text = readFileSync(join(__dirname, './public/_headers'), 'utf8')
  const rules = new Map<string, string[]>()
  let current: string[] | undefined
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!line || line.startsWith('#')) continue
    if (/^\s/.test(line)) {
      current?.push(line.trim())
    } else {
      current = []
      rules.set(line, current)
    }
  }
  return rules.get(url) ?? []
}

describe('_headers', () => {
  it('never lets the service worker or the manifest go stale', () => {
    expect(rulesFor('/sw.js')).toContain('Cache-Control: no-cache')
    expect(rulesFor('/manifest.webmanifest')).toContain('Cache-Control: no-cache')
  })

  it('caches hashed assets for a year', () => {
    expect(rulesFor('/assets/*')).toContain('Cache-Control: public, max-age=31536000, immutable')
  })

  it('hardens every response', () => {
    expect(rulesFor('/*')).toContain('X-Content-Type-Options: nosniff')
    expect(rulesFor('/*')).toContain('X-Frame-Options: DENY')
    expect(rulesFor('/*')).toContain('Referrer-Policy: strict-origin-when-cross-origin')
  })
})
