import { describe, expect, it } from 'vitest'
import { OFFLINE } from '../../sync/labels'
import { MUST_SPLIT } from '../../text/format'
import { PREMIUM_RECORDINGS_TITLE } from '../plan/planCopy'
import { recordingFile, recordingRow } from '../../test/rows'
import {
  practiceDisabledReason,
  splitDisabledReason,
  trimDisabledReason,
} from './practiceOverlayModel'
import { SPLIT_BUSY } from './splitCopy'
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
    expect(trimDisabledReason(ready, file, null, 'held', true)).toBe(TRIM_WHILE_RECORDING)
  })

  it("reads a piece's own file for capturing, never its parent's it plays from", () => {
    const piece = recordingRow('r2', { split_from_id: 'r1', state: 'processing' })
    const parentFile = recordingFile('r1', { local_state: 'capturing' })
    expect(trimDisabledReason(piece, parentFile, null, 'held', true)).not.toBe(TRIM_WHILE_RECORDING)
    expect(practiceDisabledReason(piece, parentFile, 'held', true)).toBeUndefined()
  })

  it('says a file must be split to upload by the upload limits it is given', () => {
    const pending = recordingRow('r3', { state: 'pending_upload' })
    const large = recordingFile('r3', {
      local_state: 'captured',
      local_duration_ms: 60_000,
      bytes: 501,
    })
    const limits = { max_file_bytes: 500, split_parent_max_file_bytes: 2_000 }
    expect(trimDisabledReason(pending, large, limits, 'unavailable', true)).toBe(MUST_SPLIT)
    expect(trimDisabledReason(pending, large, null, 'unavailable', true)).not.toBe(MUST_SPLIT)
  })

  it('blocks trim offline when this device has no audio', () => {
    expect(trimDisabledReason(ready, undefined, null, 'offline', true)).toBe(OFFLINE)
  })

  it('allows trim on held audio with a known length', () => {
    expect(trimDisabledReason(ready, recordingFile('r1'), null, 'held', true)).toBeUndefined()
  })

  it('blocks trim while the plan plays no recording', () => {
    expect(trimDisabledReason(ready, recordingFile('r1'), null, 'held', false)).toBe(
      PREMIUM_RECORDINGS_TITLE,
    )
  })
})

describe('splitDisabledReason', () => {
  const file = recordingFile('r1')

  it("gives Trim's reasons first", () => {
    const file = recordingFile('r1', { local_state: 'capturing' })
    const busy = { ...ready, split_id: 's1', split_completed_id: null }
    expect(splitDisabledReason(busy, file, null, 'held', true)).toBe(TRIM_WHILE_RECORDING)
  })

  it("blocks split while the row's own split is incomplete", () => {
    const busy = { ...ready, split_id: 's1', split_completed_id: null }
    expect(splitDisabledReason(busy, file, null, 'held', true)).toBe(SPLIT_BUSY)
    const done = { ...ready, split_id: 's1', split_completed_id: 's1' }
    expect(splitDisabledReason(done, file, null, 'held', true)).toBeUndefined()
  })

  it('blocks split on a piece whose file is not ready', () => {
    const piece = { ...ready, split_from_id: 'p0', state: 'processing' as const }
    expect(splitDisabledReason(piece, file, null, 'held', true)).toBe(SPLIT_BUSY)
    expect(
      splitDisabledReason({ ...piece, state: 'ready' }, file, null, 'held', true),
    ).toBeUndefined()
  })
})

describe('practiceDisabledReason', () => {
  it('blocks practice while downloading', () => {
    expect(practiceDisabledReason(ready, undefined, 'downloading', true)).toBe(
      TRIM_WHILE_DOWNLOADING,
    )
  })

  it('blocks practice while the plan plays no recording', () => {
    expect(practiceDisabledReason(ready, recordingFile('r1'), 'held', false)).toBe(
      PREMIUM_RECORDINGS_TITLE,
    )
  })

  it('allows practice on held audio', () => {
    expect(practiceDisabledReason(ready, recordingFile('r1'), 'held', true)).toBeUndefined()
  })
})
