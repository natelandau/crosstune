import { describe, expect, it } from 'vitest'
import fixture from '../../../../../fixtures/export/recording-names.json'
import { recordingRow } from '../../../test/rows'
import type { RecordingView } from '../useRecordings'
import { fileNames, nameInput, type NameInput } from './exportName'

interface Item {
  title: string
  title_is_date: boolean
  recorded_at: string | null
  recorded_precision: string | null
  content_type: string | null
}

function toInput(item: Item): NameInput {
  return {
    title: item.title,
    titleIsDate: item.title_is_date,
    recordedAt: item.recorded_at,
    precision: item.recorded_precision as NameInput['precision'],
    contentType: item.content_type,
  }
}

describe('fileNames', () => {
  it.each(fixture.single)('names a single recording: $case', (item) => {
    expect(fileNames([toInput(item)], fixture.time_zone)[0]).toBe(item.expected)
  })

  it.each(fixture.batches)('names a batch: $case', ({ items, expected }) => {
    expect(fileNames(items.map(toInput), fixture.time_zone)).toEqual(expected)
  })
})

describe('nameInput', () => {
  const view = (
    extra: Parameters<typeof recordingRow>[1],
    tuneTitle: string | null,
  ): RecordingView => ({
    recording: recordingRow('r1', extra),
    file: undefined,
    tuneId: null,
    tuneTitle,
    holdsSplitAudio: false,
  })

  it('titles with the label and carries a known date', () => {
    const input = nameInput(
      view(
        { label: 'Jam', recorded_at: '2026-09-14T00:00:00Z', recorded_precision: 'day' },
        'Tune',
      ),
      'audio/mp4',
    )
    expect(input).toMatchObject({
      title: 'Jam',
      titleIsDate: false,
      recordedAt: '2026-09-14T00:00:00Z',
      precision: 'day',
      contentType: 'audio/mp4',
    })
  })

  it('drops a precision this client does not know', () => {
    const input = nameInput(
      view({ recorded_at: '2026-09-14T00:00:00Z', recorded_precision: 'decade' }, 'Tune'),
      null,
    )
    expect(input).toMatchObject({ title: 'Tune', recordedAt: null, precision: null })
  })

  it('marks a title that falls through to the date', () => {
    expect(nameInput(view({}, null), null).titleIsDate).toBe(true)
  })
})
