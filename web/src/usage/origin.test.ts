import { describe, expect, it } from 'vitest'
import { originOf, recordingOrigin } from './origin'

describe('originOf', () => {
  it('maps each recording source to its origin', () => {
    expect(originOf('microphone')).toBe('recorded')
    expect(originOf('upload')).toBe('imported')
    expect(originOf('import')).toBe('slippery_hill')
  })

  it('reads a stored row, treating a source it does not know as imported', () => {
    expect(recordingOrigin({ source: 'microphone' })).toBe('recorded')
    expect(recordingOrigin({ source: 'from_the_future' })).toBe('imported')
  })
})
