import { describe, expect, it } from 'vitest'
import { recordingFile, recordingRow } from '../../test/rows'
import { encodePeaks } from '../waveform/peaks'
import { shownPeaks, trimmedLengthMs, trimPending } from './recordingRange'

/** Ten seconds of peaks whose byte at each point is its own index mod 256. */
const tenSeconds = encodePeaks(Uint8Array.from({ length: 500 }, (_, i) => i % 256))

describe('shownPeaks', () => {
  it('is null without peaks', () => {
    expect(shownPeaks(recordingRow('r1'), recordingFile('r1'))).toBeNull()
    expect(shownPeaks(recordingRow('r1'), undefined)).toBeNull()
  })

  it('is null for a file it cannot read', () => {
    const file = recordingFile('r1', { peaks: Uint8Array.from([9, 9]) })
    expect(shownPeaks(recordingRow('r1'), file)).toBeNull()
  })

  it('shows capture-time peaks, which start at the source start, from the trim start', () => {
    const row = recordingRow('r1', { trim_start_ms: 2000, trim_end_ms: 6000, playback_start_ms: 0 })
    const file = recordingFile('r1', { peaks: tenSeconds, peaks_rev: null })
    const { peaks } = shownPeaks(row, file)!
    expect(peaks.values).toHaveLength(200)
    expect(peaks.values[0]).toBe(100)
  })

  it("places server peaks at the row's playback start", () => {
    // The playback file, and so its peaks, begins 3 s into the source.
    const row = recordingRow('r1', {
      trim_start_ms: 4000,
      trim_end_ms: 8000,
      playback_start_ms: 3000,
      playback_end_ms: 13000,
    })
    const file = recordingFile('r1', { peaks: tenSeconds, peaks_rev: 'abcd1234' })
    const { peaks } = shownPeaks({ ...row, peaks_rev: 'abcd1234' }, file)!
    expect(peaks.values).toHaveLength(200)
    expect(peaks.values[0]).toBe(50)
  })

  it('shows no server peaks from a revision the row has moved past', () => {
    const row = recordingRow('r1', { playback_start_ms: 3000, peaks_rev: 'bbbb2222' })
    const file = recordingFile('r1', { peaks: tenSeconds, peaks_rev: 'abcd1234' })
    expect(shownPeaks(row, file)).toBeNull()
  })

  it('keeps capture-time peaks once the server has its own', () => {
    const row = recordingRow('r1', { playback_start_ms: 0, peaks_rev: 'bbbb2222' })
    const file = recordingFile('r1', { peaks: tenSeconds, peaks_rev: null })
    expect(shownPeaks(row, file)!.peaks.values).toHaveLength(500)
  })

  it("scales to the whole file's loudest point, not the slice's", () => {
    // The loudest byte, 255, sits 5.1 s in, outside the kept first second.
    const row = recordingRow('r1', { trim_start_ms: 0, trim_end_ms: 1000 })
    const file = recordingFile('r1', { peaks: tenSeconds, peaks_rev: null })
    const shown = shownPeaks(row, file)!
    expect(Math.max(...shown.peaks.values)).toBe(49)
    expect(shown.loudest).toBe(255)
  })

  it('runs to the end of the peaks when the trim has no end', () => {
    const row = recordingRow('r1', { trim_start_ms: 1000, trim_end_ms: null })
    const file = recordingFile('r1', { peaks: tenSeconds, peaks_rev: null })
    expect(shownPeaks(row, file)!.peaks.values).toHaveLength(450)
  })
})

describe('trimPending', () => {
  const applied = {
    state: 'ready',
    trim_start_ms: 1000,
    trim_end_ms: 5000,
    source_duration_ms: 9000,
    playback_start_ms: 1000,
    playback_end_ms: 5000,
  }

  it('is false once the server has cut the playback file to the trim', () => {
    expect(trimPending(recordingRow('r1', applied))).toBe(false)
  })

  it('is false for an untrimmed recording, whose trim end is the source end', () => {
    const row = recordingRow('r1', {
      ...applied,
      trim_start_ms: 0,
      trim_end_ms: null,
      playback_start_ms: 0,
      playback_end_ms: 9000,
    })
    expect(trimPending(row)).toBe(false)
  })

  it('is true while the trim differs from the playback range of a ready row', () => {
    expect(trimPending(recordingRow('r1', { ...applied, trim_start_ms: 2000 }))).toBe(true)
    expect(trimPending(recordingRow('r1', { ...applied, trim_end_ms: 4000 }))).toBe(true)
  })

  it('is false before the server has a playback range, or before the row is ready', () => {
    expect(
      trimPending(
        recordingRow('r1', {
          ...applied,
          trim_start_ms: 2000,
          playback_start_ms: null,
          playback_end_ms: null,
        }),
      ),
    ).toBe(false)
    expect(
      trimPending(recordingRow('r1', { ...applied, state: 'processing', trim_start_ms: 2000 })),
    ).toBe(false)
  })
})

describe('trimmedLengthMs', () => {
  it('measures the trim range', () => {
    const row = recordingRow('r1', { trim_start_ms: 1000, trim_end_ms: 4000 })
    expect(trimmedLengthMs(row, undefined)).toBe(3000)
  })

  it("runs an open trim to the source end, or a capture's own length", () => {
    const row = recordingRow('r1', { trim_start_ms: 1000, source_duration_ms: 9000 })
    expect(trimmedLengthMs(row, undefined)).toBe(8000)
    const capture = recordingRow('r2', { trim_start_ms: 0 })
    expect(trimmedLengthMs(capture, recordingFile('r2', { local_duration_ms: 3000 }))).toBe(3000)
  })

  it('is null when nothing says how long the recording is', () => {
    expect(trimmedLengthMs(recordingRow('r1'), undefined)).toBeNull()
  })
})
