import { describe, expect, it } from 'vitest'
import { failedTriesLabel, fileStateLabel, formatBytes, formatDuration } from './format'

describe('format', () => {
  it('formats durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(61_430)).toBe('1:01')
    expect(formatDuration(3_600_000)).toBe('60:00')
    expect(formatDuration(null)).toBe('')
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
    const row = { state: 'pending_upload', error: null } as const
    expect(fileStateLabel(row, { local_state: 'captured' })).toBe('Waiting to upload')
    expect(fileStateLabel(row, { local_state: 'uploading' })).toBe('Uploading')
    expect(fileStateLabel(row, { local_state: 'blocked_quota' })).toBe('Storage full')
    expect(fileStateLabel(row, { local_state: 'failed_upload' })).toBe('Upload failed')
    expect(fileStateLabel({ state: 'processing', error: null }, { local_state: 'uploaded' })).toBe(
      'Processing',
    )
    expect(fileStateLabel({ state: 'failed', error: 'x' }, { local_state: 'uploaded' })).toBe(
      "Couldn't process",
    )
    expect(fileStateLabel({ state: 'ready', error: null }, { local_state: 'uploaded' })).toBe('')
    expect(fileStateLabel({ state: 'ready', error: null }, undefined)).toBe('')
  })
})
