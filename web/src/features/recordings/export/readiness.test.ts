import { describe, expect, it } from 'vitest'
import type { LocalFileState } from '../../../db/recordings'
import type { LocalRecording } from '../../../db/types'
import { recordingFile, recordingRow } from '../../../test/rows'
import type { RecordingView } from '../useRecordings'
import { exportReadiness, type ExportReadiness } from './readiness'

const BLOB = new Blob(['audio'])

function view(
  state: string,
  file: { blob: Blob | null; local_state: LocalFileState } | null,
): RecordingView {
  return {
    recording: recordingRow('r1', { state: state as LocalRecording['state'] }),
    file: file ? recordingFile('r1', file) : undefined,
    tuneId: null,
    tuneTitle: null,
    holdsSplitAudio: false,
  }
}

describe('exportReadiness', () => {
  it.each<[string, RecordingView, boolean, ExportReadiness]>([
    [
      'capturing',
      view('pending_upload', { blob: BLOB, local_state: 'capturing' }),
      true,
      { kind: 'blocked', reason: 'capturing' },
    ],
    [
      'uploading blob',
      view('pending_upload', { blob: BLOB, local_state: 'uploading' }),
      true,
      { kind: 'local', blob: BLOB },
    ],
    [
      'quota blob',
      view('pending_upload', { blob: BLOB, local_state: 'blocked_quota' }),
      false,
      { kind: 'local', blob: BLOB },
    ],
    [
      'failed blob',
      view('failed', { blob: BLOB, local_state: 'uploaded' }),
      false,
      { kind: 'local', blob: BLOB },
    ],
    ['ready, online', view('ready', null), true, { kind: 'fetch' }],
    ['ready, offline', view('ready', null), false, { kind: 'blocked', reason: 'offline' }],
    [
      'ready, file without blob, offline',
      view('ready', { blob: null, local_state: 'uploaded' }),
      false,
      { kind: 'blocked', reason: 'offline' },
    ],
    ['processing', view('processing', null), true, { kind: 'blocked', reason: 'not_ready' }],
  ])('%s', (_name, input, online, expected) => {
    expect(exportReadiness(input, online)).toEqual(expected)
  })
})
