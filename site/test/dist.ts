import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { JSDOM } from 'jsdom'

export const dist = resolve(import.meta.dirname, '../dist')

export function parseHtml(html: string): Document {
  return new JSDOM(html).window.document
}

// Parses the built page for a route such as `/` or `/privacy`.
export function readPage(path: string): Document {
  return parseHtml(readFileSync(resolve(dist, `.${path}`, 'index.html'), 'utf8'))
}

export function readDist(path: string): string {
  return readFileSync(resolve(dist, `.${path}`), 'utf8')
}

export function htmlFiles(dir = dist): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return htmlFiles(path)
    return name.endsWith('.html') ? [path] : []
  })
}
