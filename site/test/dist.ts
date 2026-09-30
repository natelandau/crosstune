import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JSDOM } from 'jsdom'

const dist = resolve(import.meta.dirname, '../dist')

// Parses the built page for a route such as `/` or `/privacy`.
export function readPage(path: string): Document {
  const file = resolve(dist, `.${path}`, 'index.html')
  return new JSDOM(readFileSync(file, 'utf8')).window.document
}

export function readDist(path: string): string {
  return readFileSync(resolve(dist, `.${path}`), 'utf8')
}
