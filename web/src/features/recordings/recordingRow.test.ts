import { describe, expect, it } from 'vitest'
import type { StorageFigures } from '../../db/meta'
import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import { recordingFile, recordingRow } from '../../test/rows'
import { PROCESS_FAILED, UPLOAD_FAILED, WAITING_TO_UPLOAD } from '../recording/format'
import type { RecordingView } from './useRecordings'
import { recordingMeta, recordingTitle, retryKind, rowControl } from './recordingRow'

function view(
  overrides: {
    recording?: Partial<LocalRecording>
    file?: RecordingFile | undefined
    tuneId?: string | null
    tuneTitle?: string | null
  } = {},
): RecordingView {
  return {
    recording: recordingRow('r1', overrides.recording),
    file: overrides.file,
    tuneId: overrides.tuneId ?? null,
    tuneTitle: overrides.tuneTitle ?? null,
  }
}

describe('recordingTitle', () => {
  it('uses the label when the view has one', () => {
    expect(
      recordingTitle(view({ recording: { label: 'Jam recording' }, tuneTitle: 'Cluck Old Hen' })),
    ).toBe('Jam recording')
  })

  it('uses the tune title when there is no label and no heading names the tune', () => {
    expect(recordingTitle(view({ recording: { label: null }, tuneTitle: 'Cluck Old Hen' }))).toBe(
      'Cluck Old Hen',
    )
  })

  it('skips the tune title under a heading that already names the tune', () => {
    const recordedAt = '2026-03-14T20:05:00.000Z'
    expect(
      recordingTitle(
        view({ recording: { label: null, recorded_at: recordedAt }, tuneTitle: 'Cluck Old Hen' }),
        { tuneNamedAbove: true },
      ),
    ).toBe('Recording, Mar 14, 2026, 8:05 PM')
  })

  it('keeps the label under a heading that already names the tune', () => {
    expect(
      recordingTitle(view({ recording: { label: 'Jam recording' }, tuneTitle: 'Cluck Old Hen' }), {
        tuneNamedAbove: true,
      }),
    ).toBe('Jam recording')
  })

  it('falls back to Recording, <date> when there is neither', () => {
    // A literal string, not derived from the module's own toLocaleString call, so a format
    // regression in recordedAtLabel cannot pass silently. vitest.config.ts pins TZ and LANG so
    // this reads the same wherever the suite runs.
    const recordedAt = '2026-03-14T20:05:00.000Z'
    expect(recordingTitle(view({ recording: { label: null, recorded_at: recordedAt } }))).toBe(
      'Recording, Mar 14, 2026, 8:05 PM',
    )
  })
})

describe('recordingMeta', () => {
  it('orders duration then the date for a ready recording with nothing else to say', () => {
    const recordedAt = '2026-03-14T20:05:00.000Z'
    const result = recordingMeta(
      view({ recording: { duration_ms: 42_000, state: 'ready', recorded_at: recordedAt } }),
      null,
    )
    expect(result).toEqual(['0:42', 'Mar 14, 2026, 8:05 PM'])
  })

  it('adds a waiting status and its failed tries for a captured file', () => {
    const result = recordingMeta(
      view({
        recording: { duration_ms: 42_000 },
        file: recordingFile('r1', { local_state: 'captured', upload_attempts: 2 }),
      }),
      null,
    )
    expect(result).toEqual(['0:42', WAITING_TO_UPLOAD, '2 failed tries'])
  })

  it('adds the storage label for a blocked upload when storage figures are known', () => {
    const storage: StorageFigures = {
      used_bytes: 1_000_000,
      quota_bytes: 2_000_000,
      max_file_bytes: 500_000,
    }
    const result = recordingMeta(
      view({ file: recordingFile('r1', { local_state: 'blocked_quota' }) }),
      storage,
    )
    expect(result).toContain('1 MB of 2 MB used')
  })

  it('omits the storage label for a blocked upload when storage figures are unknown', () => {
    const result = recordingMeta(
      view({ file: recordingFile('r1', { local_state: 'blocked_quota' }) }),
      null,
    )
    expect(result.some((part) => part.includes('used'))).toBe(false)
  })

  it('says Processing for a recording the server is still transcoding', () => {
    const result = recordingMeta(view({ recording: { state: 'processing' } }), null)
    expect(result).toContain('Processing')
  })

  it("says Couldn't process for a recording the server failed to transcode", () => {
    const result = recordingMeta(view({ recording: { state: 'failed' } }), null)
    expect(result).toContain(PROCESS_FAILED)
  })

  it('leaves out the failed tries count for a refused upload', () => {
    const result = recordingMeta(
      view({ file: recordingFile('r1', { local_state: 'failed_upload', upload_attempts: 3 }) }),
      null,
    )
    expect(result).toEqual([UPLOAD_FAILED])
  })
})

describe('rowControl', () => {
  it('offers play for a held blob', () => {
    const result = rowControl(view({ file: recordingFile('r1', { blob: new Blob(['x']) }) }), {
      loaded: false,
      downloading: false,
    })
    expect(result).toBe('play')
  })

  it('offers close for the loaded item', () => {
    const result = rowControl(view({ recording: { state: 'processing' } }), {
      loaded: true,
      downloading: false,
    })
    expect(result).toBe('close')
  })

  it('lets loaded beat a held blob', () => {
    const result = rowControl(view({ file: recordingFile('r1', { blob: new Blob(['x']) }) }), {
      loaded: true,
      downloading: false,
    })
    expect(result).toBe('close')
  })

  it('offers download when the server holds it and this device does not', () => {
    const result = rowControl(view({ recording: { state: 'ready' } }), {
      loaded: false,
      downloading: false,
    })
    expect(result).toBe('download')
  })

  it('shows downloading while a fetch is in flight', () => {
    const result = rowControl(view({ recording: { state: 'ready' } }), {
      loaded: false,
      downloading: true,
    })
    expect(result).toBe('downloading')
  })

  it('offers nothing while the server is still preparing it', () => {
    const result = rowControl(view({ recording: { state: 'processing' } }), {
      loaded: false,
      downloading: false,
    })
    expect(result).toBe('none')
  })

  it('ignores a stale downloading file state once the server has failed the recording', () => {
    const result = rowControl(
      view({
        recording: { state: 'failed' },
        file: recordingFile('r1', { local_state: 'downloading' }),
      }),
      { loaded: false, downloading: true },
    )
    expect(result).toBe('none')
  })
})

describe('retryKind', () => {
  it('asks for an upload retry when the local upload failed', () => {
    expect(retryKind(view({ file: recordingFile('r1', { local_state: 'failed_upload' }) }))).toBe(
      'upload',
    )
  })

  it('asks for an upload retry when a captured file has failed attempts', () => {
    expect(
      retryKind(
        view({ file: recordingFile('r1', { local_state: 'captured', upload_attempts: 1 }) }),
      ),
    ).toBe('upload')
  })

  it('asks for a transcode retry when the server failed to process it', () => {
    expect(retryKind(view({ recording: { state: 'failed' } }))).toBe('transcode')
  })

  it('lets a stuck upload beat a server failure asking for the same row', () => {
    expect(
      retryKind(
        view({
          recording: { state: 'failed' },
          file: recordingFile('r1', { local_state: 'failed_upload' }),
        }),
      ),
    ).toBe('upload')
  })

  it('asks for nothing when the row is not stuck', () => {
    expect(
      retryKind(
        view({
          recording: { state: 'ready' },
          file: recordingFile('r1', { local_state: 'captured' }),
        }),
      ),
    ).toBeNull()
  })
})
