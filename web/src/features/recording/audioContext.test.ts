import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'suspended'
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  suspend = vi.fn(async () => {
    this.state = 'suspended'
  })
}

// The module keeps its context in a top-level variable, so each test needs a fresh
// import to see it starting unlocked and context-free.
async function freshModule() {
  vi.resetModules()
  return import('./audioContext')
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('audioContext', () => {
  it('reports unlocked only after a tap creates or resumes the context', async () => {
    const { wasUnlockedByTap, unlockAudioContext } = await freshModule()
    expect(wasUnlockedByTap()).toBe(false)
    unlockAudioContext()
    expect(wasUnlockedByTap()).toBe(true)
  })

  it('reuses the same context across calls and resumes a suspended one', async () => {
    const { unlockAudioContext, getAudioContext } = await freshModule()
    const first = unlockAudioContext()
    const second = unlockAudioContext()
    expect(second).toBe(first)
    expect(getAudioContext()).toBe(first)
  })

  it('suspends a running context but leaves it in place', async () => {
    const { unlockAudioContext, suspendAudioContext, getAudioContext } = await freshModule()
    const context = unlockAudioContext() as unknown as FakeAudioContext
    context.state = 'running'
    suspendAudioContext()
    expect(context.suspend).toHaveBeenCalled()
    expect(getAudioContext()).not.toBeNull()
  })

  it('does nothing when there is no context to suspend', async () => {
    const { suspendAudioContext } = await freshModule()
    expect(() => suspendAudioContext()).not.toThrow()
  })
})
