import { describe, expect, it, vi } from 'vitest'
import {
  addedDateLabel,
  failedTriesLabel,
  fileStateLabel,
  formatBytes,
  formatDuration,
  formatPreciseDuration,
  PROCESS_FAILED,
  recordedDateLabel,
  recordingDateLabel,
  STORAGE_FULL,
  UPLOAD_FAILED,
  WAITING_TO_UPLOAD,
} from './format'

describe('format', () => {
  it('formats durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(61_430)).toBe('1:01')
    expect(formatDuration(3_600_000)).toBe('60:00')
    expect(formatDuration(null)).toBe('')
  })

  it('formats precise durations as m:ss.t', () => {
    expect(formatPreciseDuration(0)).toBe('0:00.0')
    expect(formatPreciseDuration(61_430)).toBe('1:01.4')
    expect(formatPreciseDuration(59_960)).toBe('1:00.0')
    expect(formatPreciseDuration(3_600_000)).toBe('60:00.0')
  })

  it('formats bytes in the nearest unit', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(1500)).toBe('2 KB')
    expect(formatBytes(2_922_000)).toBe('2.9 MB')
    expect(formatBytes(500_000_000)).toBe('500 MB')
    expect(formatBytes(1_073_741_824)).toBe('1 GB')
  })

  it('counts failed tries with the right plural', () => {
    expect(failedTriesLabel(1)).toBe('1 failed try')
    expect(failedTriesLabel(3)).toBe('3 failed tries')
  })

  it('labels the state a user cares about', () => {
    const row = { state: 'pending_upload', error: null, source: 'microphone' } as const
    expect(fileStateLabel(row, { local_state: 'captured' })).toBe(WAITING_TO_UPLOAD)
    expect(fileStateLabel(row, { local_state: 'uploading' })).toBe('Uploading')
    expect(fileStateLabel(row, { local_state: 'blocked_quota' })).toBe(STORAGE_FULL)
    expect(fileStateLabel(row, { local_state: 'failed_upload' })).toBe(UPLOAD_FAILED)
    expect(
      fileStateLabel(
        { state: 'processing', error: null, source: 'upload' },
        { local_state: 'uploaded' },
      ),
    ).toBe('Processing')
    expect(
      fileStateLabel(
        { state: 'failed', error: 'x', source: 'upload' },
        { local_state: 'uploaded' },
      ),
    ).toBe(PROCESS_FAILED)
    expect(
      fileStateLabel(
        { state: 'ready', error: null, source: 'upload' },
        { local_state: 'uploaded' },
      ),
    ).toBe('')
    expect(fileStateLabel({ state: 'ready', error: null, source: 'upload' }, undefined)).toBe('')
    expect(
      fileStateLabel({ state: 'pending_upload', error: null, source: 'import' }, undefined),
    ).toBe('Processing')
    expect(
      fileStateLabel({ state: 'pending_upload', error: null, source: 'upload' }, undefined),
    ).toBe('')
  })
})

describe('recordedDateLabel', () => {
  it('formats a partial date at its precision', () => {
    expect(recordedDateLabel('1937-01-01T00:00:00Z', 'year')).toBe('1937')
    expect(recordedDateLabel('1998-05-01T00:00:00Z', 'month')).toBe('May 1998')
    expect(recordedDateLabel('1998-10-03T00:00:00Z', 'day')).toBe('Oct 3, 1998')
  })

  it('formats a take with its date and time', () => {
    expect(recordedDateLabel('2026-10-03T16:12:00Z', 'time')).toBe('Oct 3, 2026, 4:12 PM')
  })

  it('keeps a partial date in its own period west of UTC', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    // The formatters take the zone when the module loads, so it loads again under this one.
    vi.resetModules()
    try {
      // Proves the zone took: local time reads the stored instant as the year before.
      expect(new Date('1937-01-01T00:00:00Z').getFullYear()).toBe(1936)
      const west = await import('./format')
      expect(west.recordedDateLabel('1937-01-01T00:00:00Z', 'year')).toBe('1937')
      expect(west.recordedDateLabel('1998-05-01T00:00:00Z', 'month')).toBe('May 1998')
      expect(west.recordedDateLabel('1998-10-03T00:00:00Z', 'day')).toBe('Oct 3, 1998')
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})

describe('addedDateLabel', () => {
  it('names the day a recording was added', () => {
    expect(addedDateLabel('2026-10-04T15:00:00Z')).toBe('Added Oct 4, 2026')
  })
})

describe('recordingDateLabel', () => {
  it('shows the recorded date when known and when it was added otherwise', () => {
    const added_at = '2026-10-04T15:00:00Z'
    expect(
      recordingDateLabel({
        added_at,
        recorded_at: '1937-01-01T00:00:00Z',
        recorded_precision: 'year',
      }),
    ).toBe('1937')
    expect(recordingDateLabel({ added_at, recorded_at: null, recorded_precision: null })).toBe(
      'Added Oct 4, 2026',
    )
  })
})
