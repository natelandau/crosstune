import { describe, expect, it } from 'vitest'
import {
  createQueue,
  cycleRepeat,
  jump,
  next,
  previous,
  RESTART_AFTER_MS,
  setShuffled,
  type Queue,
} from './listQueue'
import { seeded } from '../../test/random'

const TUNES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

function advance(queue: Queue, steps: number): Queue {
  let at = queue
  for (let i = 0; i < steps; i++) at = next(at, { manual: true, repeat: 'off' }).queue
  return at
}

describe('createQueue', () => {
  it('keeps the first occurrence of a tune listed twice', () => {
    const queue = createQueue(['a', 'b', 'a', 'c', 'b'], { shuffled: false })
    expect(queue.order).toEqual(['a', 'b', 'c'])
    expect(queue.count).toBe(3)
    expect(queue.current).toBe('a')
    expect(queue.position).toBe(1)
  })

  it('shuffles into a permutation of the list', () => {
    const queue = createQueue(TUNES, { shuffled: true, random: seeded(7) })
    expect([...queue.order].sort()).toEqual(TUNES)
    expect(queue.order).not.toEqual(TUNES)
    expect(queue.current).toBe(queue.order[0])
  })

  it('holds nothing for an empty list', () => {
    const queue = createQueue([], { shuffled: false })
    expect(queue.current).toBeNull()
    expect(queue.position).toBe(0)
    expect(next(queue, { manual: true, repeat: 'list' }).ended).toBe(true)
  })
})

describe('previous', () => {
  const second = advance(createQueue(TUNES, { shuffled: false }), 1)

  it('goes back one tune before the restart threshold', () => {
    const result = previous(second, 2900)
    expect(result.restart).toBe(false)
    expect(result.queue.current).toBe('a')
  })

  it('restarts the tune past the threshold', () => {
    expect(RESTART_AFTER_MS).toBe(3000)
    const result = previous(second, 3100)
    expect(result.restart).toBe(true)
    expect(result.queue.current).toBe('b')
  })

  it('restarts at the first tune and never wraps', () => {
    const first = createQueue(TUNES, { shuffled: false })
    const result = previous(first, 0)
    expect(result.restart).toBe(true)
    expect(result.queue.current).toBe('a')
  })
})

describe('next', () => {
  const last = advance(createQueue(['a', 'b', 'c'], { shuffled: false }), 2)

  it('ends at the last tune with repeat off, staying on it', () => {
    const result = next(last, { manual: false, repeat: 'off' })
    expect(result.ended).toBe(true)
    expect(result.queue.current).toBe('c')
    expect(result.queue.position).toBe(3)
  })

  it('wraps to the first tune with repeat list', () => {
    const result = next(last, { manual: false, repeat: 'list' })
    expect(result.ended).toBe(false)
    expect(result.queue.current).toBe('a')
    expect(result.queue.position).toBe(1)
  })

  it('replays the tune on a natural end with repeat one', () => {
    const queue = createQueue(['a', 'b'], { shuffled: false })
    const result = next(queue, { manual: false, repeat: 'one' })
    expect(result.ended).toBe(false)
    expect(result.queue.current).toBe('a')
  })

  it('moves on from a manual next with repeat one', () => {
    const queue = createQueue(['a', 'b'], { shuffled: false })
    expect(next(queue, { manual: true, repeat: 'one' }).queue.current).toBe('b')
    expect(next(last, { manual: true, repeat: 'one' }).queue.current).toBe('a')
  })

  it('reshuffles on wrap without opening on the tune that just played', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = seeded(seed)
      const queue = advance(createQueue(['a', 'b', 'c'], { shuffled: true, random }), 2)
      const playing = queue.current
      const wrapped = next(queue, { manual: false, repeat: 'list', random }).queue
      expect(wrapped.current).not.toBe(playing)
      expect([...wrapped.order].sort()).toEqual(['a', 'b', 'c'])
      expect(wrapped.position).toBe(1)
    }
  })

  it('moves on from a skip under repeat one and keeps the count', () => {
    const second = advance(createQueue(['a', 'b', 'c'], { shuffled: false }), 1)
    const skipped = next(second, { manual: true, repeat: 'one' })
    expect(skipped.ended).toBe(false)
    expect(skipped.queue.current).toBe('c')
    expect(skipped.queue.position).toBe(3)
    expect(skipped.queue.count).toBe(3)
  })

  it('keeps the count fixed through every move', () => {
    let queue = createQueue(TUNES, { shuffled: true, random: seeded(3) })
    for (let i = 0; i < 20; i++) {
      queue = next(queue, { manual: true, repeat: 'list', random: seeded(i) }).queue
      expect(queue.count).toBe(TUNES.length)
    }
  })
})

describe('cycleRepeat', () => {
  it('goes off, list, one, off', () => {
    expect(cycleRepeat('off')).toBe('list')
    expect(cycleRepeat('list')).toBe('one')
    expect(cycleRepeat('one')).toBe('off')
  })
})

describe('setShuffled', () => {
  it('keeps played tunes and the current one in place when turned on', () => {
    const third = advance(createQueue(TUNES, { shuffled: false }), 2)
    const shuffled = setShuffled(third, true, seeded(11))
    expect(shuffled.shuffled).toBe(true)
    expect(shuffled.order.slice(0, 3)).toEqual(['a', 'b', 'c'])
    expect([...shuffled.order.slice(3)].sort()).toEqual(TUNES.slice(3))
    expect(shuffled.order.slice(3)).not.toEqual(TUNES.slice(3))
    expect(shuffled.current).toBe('c')
    expect(shuffled.position).toBe(3)
  })

  it('resumes list order after the current tune when turned off', () => {
    const shuffled = createQueue(TUNES, { shuffled: true, random: seeded(5) })
    expect(shuffled.order).toEqual(['e', 'c', 'g', 'a', 'd', 'b', 'h', 'f'])
    const unshuffled = setShuffled(advance(shuffled, 2), false)
    expect(unshuffled.order).toEqual(TUNES)
    expect(unshuffled.current).toBe('g')
    expect(unshuffled.position).toBe(7)
    const after = next(unshuffled, { manual: true, repeat: 'off' }).queue
    expect(after.current).toBe('h')
  })

  it('changes nothing when already in that state', () => {
    const queue = createQueue(TUNES, { shuffled: false })
    expect(setShuffled(queue, false)).toBe(queue)
  })
})

describe('jump', () => {
  it('moves to a tune in the queue', () => {
    const queue = jump(createQueue(TUNES, { shuffled: false }), 'e')
    expect(queue?.current).toBe('e')
    expect(queue?.position).toBe(5)
  })

  it('refuses a tune the queue lacks', () => {
    expect(jump(createQueue(TUNES, { shuffled: false }), 'z')).toBeNull()
  })
})
