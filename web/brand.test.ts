import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { brandDir, geometry, markShapes, parseBrand } from './src/test/brand'

const coral = '#ef8354'
const slate = '#2d3142'
const white = '#ffffff'

// Every source, with the C's color for its colorway and the tile color where there is a tile.
const sources = [
  { name: 'icon-dark.svg', viewBox: '0 0 512 512', c: white, tile: slate },
  { name: 'icon-light.svg', viewBox: '0 0 512 512', c: slate, tile: white },
  { name: 'mark-dark.svg', viewBox: '39 104 434 304', c: white, tile: null },
  { name: 'mark-light.svg', viewBox: '39 104 434 304', c: slate, tile: null },
]

const docs = new Map(sources.map(({ name }) => [name, parseBrand(name)]))

function root(name: string): Element {
  const doc = docs.get(name)
  if (!doc) throw new Error(`${name} is not a listed source`)
  return doc.documentElement
}

describe('brand sources', () => {
  it('holds the mark in both colorways, bare and tiled', () => {
    const files = readdirSync(brandDir)
      .filter((name) => name.endsWith('.svg'))
      .sort()
    expect(files).toEqual(sources.map(({ name }) => name).sort())
  })

  it('draws the same mark in every file', () => {
    const reference = markShapes(root('mark-dark.svg')).map(geometry)
    expect(reference).toHaveLength(3)
    for (const { name } of sources) {
      expect(markShapes(root(name)).map(geometry), name).toEqual(reference)
    }
  })

  describe.each(sources)('$name', ({ name, viewBox, c, tile }) => {
    it('is well-formed on the documented viewBox', () => {
      expect(docs.get(name)?.querySelector('parsererror')).toBeNull()
      expect(root(name).getAttribute('viewBox')).toBe(viewBox)
    })

    it('draws the T in coral, then the C in the colorway color over it', () => {
      // The C's rect paints last so it covers the coral bar's round cap; that is what gives
      // the straight color boundary where the C's top arm meets the T.
      const painted = markShapes(root(name)).map(
        (el) => `${el.tagName} ${el.getAttribute('stroke') ?? el.getAttribute('fill')}`,
      )
      expect(painted).toEqual([`path ${coral}`, `path ${c}`, `rect ${c}`])
    })

    it(tile ? 'paints the tile first, under the mark' : 'has no tile', () => {
      const first = root(name).querySelector('path, rect')
      const tileRect = root(name).querySelector('rect[rx]')
      if (tile) {
        expect(tileRect).toBe(first)
        expect(tileRect?.getAttribute('fill')).toBe(tile)
      } else {
        expect(tileRect).toBeNull()
      }
    })
  })
})
