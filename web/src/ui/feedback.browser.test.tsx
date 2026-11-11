import { describe, expect, it, vi } from 'vitest'
import { stampAxes } from '../test/render'
import { emulateReducedMotion } from '../test/reducedMotion'
import { haptic, pop, shake, snapPulse } from './feedback'

function makeElement(): HTMLElement {
  const el = document.createElement('div')
  document.body.append(el)
  return el
}

describe('feedback motion', () => {
  it('shakes an element once', () => {
    const el = makeElement()
    shake(el)
    expect(el.getAnimations()).toHaveLength(1)
    shake(el)
    expect(el.getAnimations()).toHaveLength(1)
    el.remove()
  })

  it('pops an element', () => {
    const el = makeElement()
    pop(el)
    expect(el.getAnimations()).toHaveLength(1)
    el.remove()
  })

  it('pulses an element on a snap', () => {
    const el = makeElement()
    snapPulse(el)
    expect(el.getAnimations()).toHaveLength(1)
    el.remove()
  })

  it('skips movement under reduced motion', async () => {
    await emulateReducedMotion()
    const el = makeElement()
    shake(el)
    pop(el)
    snapPulse(el)
    expect(el.getAnimations()).toHaveLength(0)
    el.remove()
  })

  it('vibrates only on touch', () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate })
    try {
      stampAxes({ density: 'touch' })
      haptic()
      expect(vibrate).toHaveBeenCalledTimes(1)
      stampAxes({ density: 'pointer' })
      haptic()
      expect(vibrate).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does nothing on touch when vibrate is missing', () => {
    vi.stubGlobal('navigator', {})
    try {
      stampAxes({ density: 'touch' })
      expect(() => haptic()).not.toThrow()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
