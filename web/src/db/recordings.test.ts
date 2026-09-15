import { describe, expect, it } from 'vitest'
import { AUDIO_BITRATES, baseContentType, pickMimeType, storedAudioQuality } from './recordings'

describe('recordings helpers', () => {
  it('prefers mp4, then opus in webm, then plain webm', () => {
    expect(pickMimeType((m) => m === 'audio/webm')).toBe('audio/webm')
    expect(pickMimeType((m) => m.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
    expect(pickMimeType(() => true)).toBe('audio/mp4')
    expect(pickMimeType(() => false)).toBe('')
  })

  it('strips codec parameters for the API', () => {
    expect(baseContentType('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(baseContentType('audio/mp4')).toBe('audio/mp4')
    expect(baseContentType('')).toBe('application/octet-stream')
  })

  it('maps presets to bit rates and defaults to standard', () => {
    expect(AUDIO_BITRATES.low).toBe(48000)
    expect(AUDIO_BITRATES.standard).toBe(64000)
    expect(AUDIO_BITRATES.high).toBe(128000)
    expect(storedAudioQuality(null)).toBe('standard')
    expect(storedAudioQuality({ audio_quality: 'high' })).toBe('high')
    expect(storedAudioQuality({ audio_quality: 'lossless' })).toBe('standard')
  })
})
