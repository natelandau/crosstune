import { describe, expect, it } from 'vitest'
import type { LocalFileState, RecordingFile } from '../../db/recordings'
import type { RecordingView } from '../recordings/useRecordings'
import { deleteTuneMessage, deleteTunesMessage, deleteTuneTitle } from './deleteTuneMessage'

// The message reads only each recording's file state, so the rest of the view is left out.
function view(state: LocalFileState | null): RecordingView {
  const file = state ? ({ local_state: state } as RecordingFile) : undefined
  return { file } as RecordingView
}

describe('deleteTuneTitle', () => {
  it('names the tune as stored', () => {
    expect(deleteTuneTitle("Soldier's Joy")).toBe('Delete "Soldier\'s Joy"?')
  })
})

describe('deleteTuneMessage', () => {
  it('names only links and list entries when there are no recordings', () => {
    expect(deleteTuneMessage([])).toBe('This removes its links and list entries.')
  })

  it('counts a single recording in the singular', () => {
    expect(deleteTuneMessage([view('uploaded')])).toBe(
      'This removes its links, list entries, and 1 recording.',
    )
  })

  it('counts several recordings in the plural', () => {
    expect(deleteTuneMessage([view('uploaded'), view(null)])).toBe(
      'This removes its links, list entries, and 2 recordings.',
    )
  })

  it('warns when any recording has not uploaded', () => {
    expect(deleteTuneMessage([view('downloaded'), view('failed_upload')])).toBe(
      'This removes its links, list entries, and 2 recordings. Some recordings have not uploaded, so they cannot be recovered.',
    )
  })
})

describe('deleteTunesMessage', () => {
  it('speaks of the selection rather than one tune', () => {
    expect(deleteTunesMessage([])).toBe('This removes their links and list entries.')
  })

  it('counts the recordings the whole selection takes with it', () => {
    expect(deleteTunesMessage([view('uploaded'), view('downloaded')])).toBe(
      'This removes their links, list entries, and 2 recordings.',
    )
  })

  it('warns when any recording in the selection has not uploaded', () => {
    expect(deleteTunesMessage([view('uploaded'), view('captured')])).toBe(
      'This removes their links, list entries, and 2 recordings. Some recordings have not uploaded, so they cannot be recovered.',
    )
  })
})
