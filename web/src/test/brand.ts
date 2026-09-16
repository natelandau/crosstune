import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The identity sources at the repository root. The client's mark and icons are built from them. */
export const brandDir = resolve(import.meta.dirname, '../../../brand')

export function readBrand(name: string): string {
  return readFileSync(resolve(brandDir, name), 'utf8')
}

export function parseBrand(name: string): Document {
  return new DOMParser().parseFromString(readBrand(name), 'image/svg+xml')
}

/** The shapes of the mark in draw order: the T, the C's arc, then the C's rect. The tile behind
 * the mark in the icon sources is the only rounded rect, so it is left out. */
export function markShapes(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('path, rect:not([rx])'))
}

/** A shape reduced to its geometry, so colorways and the rendered component compare equal. */
export function geometry(el: Element): string {
  return el.tagName === 'path'
    ? `path ${el.getAttribute('d')}`
    : `rect ${['x', 'y', 'width', 'height'].map((a) => el.getAttribute(a)).join(' ')}`
}
