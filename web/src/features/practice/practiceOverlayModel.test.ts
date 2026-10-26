import { describe, expect, it } from 'vitest'
import { OFFLINE } from '../../sync/labels'
import { PREMIUM_RECORDINGS_TITLE } from '../plan/planCopy'
import { recordingFile, recordingRow } from '../../test/rows'
import { practiceDisabledReason, trimDisabledReason } from './practiceOverlayModel'
import { TRIM_WHILE_DOWNLOADING, TRIM_WHILE_RECORDING } from './trimViewCopy'

const ready = recordingRow('r1', {
  state: 'ready',
  source_duration_ms: 9000,
  playback_start_ms: 0,
  playback_end_ms: 9000,
})

describe('trimDisabledReason', () => {
  it('blocks trim while the recording is still capturing', () => {
    const file = recordingFile('r1', { local_state: 'capturing' })
    expect(trimDisabledReason(ready, file, 'held', true)).toBe(TRIM_WHILE_RECORDING)
  })

  it('blocks trim offline when this device has no audio', () => {
    expect(trimDisabledReason(ready, undefined, 'offline', true)).toBe(OFFLINE)
  })

  it('allows trim on held audio with a known length', () => {
    expect(trimDisabledReason(ready, recordingFile('r1'), 'held', true)).toBeUndefined()
  })

  it('blocks trim while the plan plays no recording', () => {
    expect(trimDisabledReason(ready, recordingFile('r1'), 'held', false)).toBe(
      PREMIUM_RECORDINGS_TITLE,
    )
  })
})

describe('practiceDisabledReason', () => {
  it('blocks practice while downloading', () => {
    expect(practiceDisabledReason(undefined, 'downloading', true)).toBe(TRIM_WHILE_DOWNLOADING)
  })

  it('blocks practice while the plan plays no recording', () => {
    expect(practiceDisabledReason(recordingFile('r1'), 'held', false)).toBe(
      PREMIUM_RECORDINGS_TITLE,
    )
  })

  it('allows practice on held audio', () => {
    expect(practiceDisabledReason(recordingFile('r1'), 'held', true)).toBeUndefined()
  })
})
