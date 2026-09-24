import { describe, expect, it } from 'vitest'
import { serverTune } from '../test/fakeApi'
import { liveTune } from './tunes'

describe('liveTune', () => {
  it('returns the tune when it is present and not deleted', () => {
    const tune = serverTune({ id: 's1' })
    expect(liveTune(tune)).toBe(tune)
  })

  it('returns null for a tombstoned tune', () => {
    const tune = serverTune({ id: 's1', deleted_at: '2026-09-14T00:00:00Z' })
    expect(liveTune(tune)).toBeNull()
  })

  it('returns null when there is no tune', () => {
    expect(liveTune(null)).toBeNull()
    expect(liveTune(undefined)).toBeNull()
  })
})
