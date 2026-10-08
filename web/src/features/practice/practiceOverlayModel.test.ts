import { describe, expect, it } from 'vitest'
import { OFFLINE } from '../../sync/labels'
import { recordingFile, recordingRow } from '../../test/rows'
import { practiceBlocker, trimBlocker } from './practiceOverlayModel'
import { TRIM_WHILE_DOWNLOADING, TRIM_WHILE_RECORDING } from './trimViewCopy'

const ready = recordingRow('r1', {
  state: 'ready',
  source_duration_ms: 9000,
  playback_start_ms: 0,
  playback_end_ms: 9000,
})

describe('trimBlocker', () => {
  it('blocks trim while the recording is still capturing', () => {
    const file = recordingFile('r1', { local_state: 'capturing' })
    expect(trimBlocker(ready, file, 'held')).toBe(TRIM_WHILE_RECORDING)
  })

  it('blocks trim offline when this device has no audio', () => {
    expect(trimBlocker(ready, undefined, 'offline')).toBe(OFFLINE)
  })

  it('allows trim on held audio with a known length', () => {
    expect(trimBlocker(ready, recordingFile('r1'), 'held')).toBeUndefined()
  })
})

describe('practiceBlocker', () => {
  it('blocks practice while downloading', () => {
    expect(practiceBlocker(undefined, 'downloading')).toBe(TRIM_WHILE_DOWNLOADING)
  })
})
