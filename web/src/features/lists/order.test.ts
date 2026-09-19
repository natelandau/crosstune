import { describe, expect, it } from 'vitest'
import { moveBeside, placeBeside } from './order'

const ids = ['a', 'b', 'c', 'd', 'e']
const move = (itemId: string, targetId: string) => moveBeside(ids, (id) => id, itemId, targetId)

describe('moveBeside', () => {
  it.each([
    ['down past the next item', 'b', 'c', ['a', 'c', 'b', 'd', 'e']],
    ['up past the previous item', 'c', 'b', ['a', 'c', 'b', 'd', 'e']],
    ['to the bottom', 'a', 'e', ['b', 'c', 'd', 'e', 'a']],
    ['to the top', 'e', 'a', ['e', 'a', 'b', 'c', 'd']],
    ['past a skipped item, landing beside the target', 'a', 'c', ['b', 'c', 'a', 'd', 'e']],
  ])('moves an item %s', (_name, itemId, targetId, expected) => {
    expect(move(itemId, targetId)).toEqual(expected)
  })

  it('returns the same order for a missing id or the item itself', () => {
    expect(move('a', 'zzz')).toEqual(ids)
    expect(move('zzz', 'a')).toEqual(ids)
    expect(move('b', 'b')).toEqual(ids)
  })

  it('never mutates its input', () => {
    const input = [...ids]
    moveBeside(input, (id) => id, 'a', 'e')
    expect(input).toEqual(ids)
  })
})

describe('placeBeside', () => {
  const place = (itemId: string, targetId: string, side: 'before' | 'after') =>
    placeBeside(ids, (id) => id, itemId, targetId, side)

  it.each([
    ['after a target below it', 'b', 'c', 'after', ['a', 'c', 'b', 'd', 'e']],
    ['before a target below it', 'b', 'c', 'before', ['a', 'b', 'c', 'd', 'e']],
    ['after a target above it', 'c', 'b', 'after', ['a', 'b', 'c', 'd', 'e']],
    ['before a target above it', 'c', 'b', 'before', ['a', 'c', 'b', 'd', 'e']],
  ] as const)('puts an item %s', (_name, itemId, targetId, side, expected) => {
    expect(place(itemId, targetId, side)).toEqual(expected)
  })

  it('leaves an order that already holds the move alone', () => {
    for (const [itemId, targetId, side] of [
      ['b', 'c', 'after'],
      ['e', 'a', 'before'],
      ['a', 'e', 'after'],
    ] as const) {
      const once = placeBeside(ids, (id) => id, itemId, targetId, side)
      expect(placeBeside(once, (id) => id, itemId, targetId, side)).toEqual(once)
    }
  })

  it('returns the same order for a missing id or the item itself', () => {
    expect(place('a', 'zzz', 'after')).toEqual(ids)
    expect(place('zzz', 'a', 'after')).toEqual(ids)
    expect(place('b', 'b', 'after')).toEqual(ids)
  })
})
