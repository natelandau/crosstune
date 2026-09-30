import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const dist = resolve(import.meta.dirname, '../dist')
const origin = 'https://crosstune.app'

function htmlFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return htmlFiles(path)
    return name.endsWith('.html') ? [path] : []
  })
}

// Maps a same-origin pathname to the built file that serves it, or null when none does.
function fileFor(pathname: string): string | null {
  const path = resolve(dist, `.${decodeURIComponent(pathname)}`)
  if (!path.startsWith(dist)) return null
  const candidates = [path, `${path}.html`, join(path, 'index.html')]
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null
}

// Redirect sources count as resolvable; the destination is checked like any other link.
const redirects = new Map(
  (existsSync(join(dist, '_redirects')) ? readFileSync(join(dist, '_redirects'), 'utf8') : '')
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[0].startsWith('/'))
    .map(([from, to]) => [from, to] as const),
)

const pages = htmlFiles(dist)

describe('built links', () => {
  it('finds the built pages', () => {
    expect(pages.length).toBeGreaterThan(3)
  })

  it.each(pages)('%s has no broken same-origin link', (file) => {
    const pageUrl = `${origin}/${file.slice(dist.length + 1).replace(/(^|\/)index\.html$/, '$1')}`
    const doc = new JSDOM(readFileSync(file, 'utf8')).window.document
    const broken: string[] = []

    for (const el of doc.querySelectorAll('[href], [src]')) {
      const ref = el.getAttribute('href') ?? el.getAttribute('src') ?? ''
      if (/^(mailto|tel|data):/.test(ref)) continue
      let url = new URL(ref, pageUrl)
      if (url.origin !== origin) continue
      const redirect = redirects.get(url.pathname)
      if (redirect) url = new URL(redirect, origin)

      const target = url.pathname === new URL(pageUrl).pathname ? file : fileFor(url.pathname)
      if (!target) {
        broken.push(ref)
        continue
      }
      if (url.hash.length > 1) {
        const id = decodeURIComponent(url.hash.slice(1))
        const targetDoc =
          target === file ? doc : new JSDOM(readFileSync(target, 'utf8')).window.document
        if (!targetDoc.getElementById(id)) broken.push(ref)
      }
    }

    expect(broken).toEqual([])
  })
})
