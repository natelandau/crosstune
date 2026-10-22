import { describe, expect, it } from 'vitest'
import { recordingRow } from '../../test/rows'
import { recordingMatches } from './recordingMatch'
import type { RecordingView } from './useRecordings'

function view(extra: Partial<RecordingView> = {}, label: string | null = null): RecordingView {
  return {
    recording: recordingRow('r1', { label }),
    file: undefined,
    tuneId: null,
    tuneTitle: null,
    ...extra,
  }
}

describe('recordingMatches', () => {
  it('finds a recording by its label or its tune title', () => {
    expect(recordingMatches(view({}, 'Porch take'), 'porch')).toBe(true)
    expect(recordingMatches(view({ tuneTitle: 'Cluck Old Hen' }), 'hen')).toBe(true)
    expect(recordingMatches(view({}, 'Porch take'), 'barn')).toBe(false)
  })

  it('finds a recording by the location name it shows', () => {
    const shown = view({ shownPlace: 'Town Hall' })
    expect(recordingMatches(shown, 'town hall')).toBe(true)
    expect(recordingMatches(shown, 'hall')).toBe(true)
    expect(recordingMatches(shown, 'barn')).toBe(false)
  })

  it('finds nothing by a location it does not show', () => {
    expect(recordingMatches(view({ shownPlace: null }), 'hall')).toBe(false)
    expect(recordingMatches(view(), 'hall')).toBe(false)
  })
})
