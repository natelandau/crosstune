import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { embedFor } from './src/features/player/embed'

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

function cspDirective(name: string): string[] {
  const header = rulesFor('/*').find((rule) => rule.startsWith('Content-Security-Policy: '))
  const policy = header?.slice('Content-Security-Policy: '.length) ?? ''
  const directive = policy
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([directiveName]) => directiveName === name)
  return directive?.slice(1) ?? []
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

  it('keeps every response out of search results', () => {
    expect(rulesFor('/*')).toContain('X-Robots-Tag: noindex')
  })

  it('allows the inline theme script by its hash and no other inline script', () => {
    const html = readFileSync(join(__dirname, './index.html'), 'utf8')
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
      (match) => match[1],
    )
    expect(inline).toHaveLength(1)
    const hash = createHash('sha256')
      .update(inline[0] ?? '')
      .digest('base64')
    expect(cspDirective('script-src')).toContain(`'sha256-${hash}'`)
    expect(cspDirective('script-src')).not.toContain("'unsafe-inline'")
  })

  it('lets every in-app player load', () => {
    const links = [
      { provider: 'youtube', provider_ref: 'dQw4w9WgXcQ', url: '' },
      { provider: 'spotify', provider_ref: 'track:403iATVGis7FqKA0BcTSRt', url: '' },
      { provider: 'apple_music', provider_ref: null, url: 'https://music.apple.com/us/album/x/1' },
      { provider: 'tidal', provider_ref: 'track:1', url: '' },
      { provider: 'soundcloud', provider_ref: null, url: 'https://soundcloud.com/a/b' },
      { provider: 'bandcamp', provider_ref: 'track:1', url: '' },
      { provider: 'internet_archive', provider_ref: 'item', url: '' },
    ]
    for (const link of links) {
      const embed = embedFor(link)
      expect(embed, link.provider).not.toBeNull()
      expect(cspDirective('frame-src')).toContain(new URL(embed!.src).origin)
    }
  })

  it('lets the in-dock audio player load Slippery-Hill files', () => {
    expect(cspDirective('media-src')).toContain('https://www.slippery-hill.com')
  })

  it('lets the pitch stage load its AudioWorklet and WebAssembly', () => {
    expect(cspDirective('script-src')).toContain('blob:')
    expect(cspDirective('script-src')).toContain("'wasm-unsafe-eval'")
    expect(cspDirective('script-src')).not.toContain("'unsafe-eval'")
  })

  it('keeps the microphone for recording and refuses framing', () => {
    expect(rulesFor('/*')).toContainEqual(
      expect.stringMatching(/^Permissions-Policy: .*microphone=\(self\)/),
    )
    expect(cspDirective('frame-ancestors')).toEqual(["'none'"])
    expect(cspDirective('object-src')).toEqual(["'none'"])
  })
})
