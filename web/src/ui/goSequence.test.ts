import { describe, expect, it } from 'vitest'
import { createGoSequence, GO_SEQUENCE_MS } from './goSequence'

/** A key as pressed with no Shift, the way most of these tests type it. */
const bare = (key: string) => ({ key, shiftKey: false })

function sequence() {
  let time = 0
  const go = createGoSequence(() => time)
  return { go, advance: (ms: number) => (time += ms) }
}

describe('createGoSequence', () => {
  it('starts on g', () => {
    expect(sequence().go.press(bare('g'))).toBe('started')
  })

  it('ignores a destination letter with no G before it', () => {
    expect(sequence().go.press(bare('c'))).toBeNull()
  })

  it('goes to the destination pressed in time', () => {
    const { go, advance } = sequence()
    go.press(bare('g'))
    advance(GO_SEQUENCE_MS)
    expect(go.press(bare('c'))).toBe('catalog')
  })

  it('maps each destination letter', () => {
    const { go } = sequence()
    expect(['l', 'r', 's'].map((key) => (go.press(bare('g')), go.press(bare(key))))).toEqual([
      'lists',
      'recordings',
      'settings',
    ])
  })

  it('forgets G once the time runs out', () => {
    const { go, advance } = sequence()
    go.press(bare('g'))
    advance(GO_SEQUENCE_MS + 1)
    expect(go.press(bare('c'))).toBeNull()
  })

  it('ends on any other key', () => {
    const { go } = sequence()
    go.press(bare('g'))
    expect(go.press(bare('x'))).toBe('ended')
    expect(go.press(bare('c'))).toBeNull()
  })

  it('starts again on a second G', () => {
    const { go } = sequence()
    go.press(bare('g'))
    expect(go.press(bare('g'))).toBe('started')
  })

  it('ends after a destination', () => {
    const { go } = sequence()
    go.press(bare('g'))
    go.press(bare('c'))
    expect(go.press(bare('l'))).toBeNull()
  })

  it('restarts the time on a second G', () => {
    const { go, advance } = sequence()
    go.press(bare('g'))
    advance(1000)
    go.press(bare('g'))
    advance(1000)
    expect(go.press(bare('c'))).toBe('catalog')
  })

  it.each(['Shift', 'Meta', 'Control', 'Alt'])('passes over a lone %s', (modifier) => {
    const { go } = sequence()
    go.press(bare('g'))
    expect(go.press({ key: modifier, shiftKey: modifier === 'Shift' })).toBeNull()
    expect(go.press(bare('c'))).toBe('catalog')
  })

  it('takes no shifted letter, whatever case Caps Lock gives it', () => {
    const { go } = sequence()
    expect(go.press({ key: 'G', shiftKey: true })).toBeNull()
    expect(go.press({ key: 'g', shiftKey: true })).toBeNull()
    go.press(bare('g'))
    expect(go.press({ key: 'C', shiftKey: true })).toBe('ended')
  })

  it('reads letters typed under Caps Lock as the letters', () => {
    const { go } = sequence()
    expect(go.press(bare('G'))).toBe('started')
    expect(go.press(bare('L'))).toBe('lists')
  })

  it('forgets G on reset', () => {
    const { go } = sequence()
    go.press(bare('g'))
    go.reset()
    expect(go.press(bare('c'))).toBeNull()
  })
})
