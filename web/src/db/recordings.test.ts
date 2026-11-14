import { describe, expect, it } from 'vitest'
import { AUDIO_BITRATES } from '../constants'
import { openTestDb } from '../test/db'
import { recordingRow } from '../test/rows'
import {
  baseContentType,
  countLiveRecordings,
  pickMimeType,
  storedAudioQuality,
} from './recordings'

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

  it('maps presets to bit rates and defaults to highest', () => {
    expect(AUDIO_BITRATES.low).toBe(48000)
    expect(AUDIO_BITRATES.standard).toBe(64000)
    expect(AUDIO_BITRATES.high).toBe(128000)
    expect(AUDIO_BITRATES.highest).toBe(160000)
    expect(storedAudioQuality(null)).toBe('highest')
    expect(storedAudioQuality({ audio_quality: 'high' })).toBe('high')
    expect(storedAudioQuality({ audio_quality: 'lossless' })).toBe('highest')
  })
})

describe('countLiveRecordings', () => {
  it('counts live recordings and leaves out deleted ones', async () => {
    const db = openTestDb()
    expect(await countLiveRecordings(db)).toBe(0)
    await db.recordings.bulkPut([
      recordingRow('a'),
      recordingRow('b'),
      recordingRow('gone', { deleted_at: '2026-02-01T00:00:00.000Z' }),
    ])
    expect(await countLiveRecordings(db)).toBe(2)
  })
})
