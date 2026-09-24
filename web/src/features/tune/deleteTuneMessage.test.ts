import { describe, expect, it } from 'vitest'
import type { LocalFileState, RecordingFile } from '../../db/recordings'
import type { RecordingView } from '../recordings/useRecordings'
import { deleteTuneMessage, deleteTunesMessage } from './deleteTuneMessage'

// The message reads only each recording's file state, so the rest of the view is left out.
function view(state: LocalFileState | null): RecordingView {
  const file = state ? ({ local_state: state } as RecordingFile) : undefined
  return { file } as RecordingView
}

describe('deleteTuneMessage', () => {
  it('names only links and list entries when there are no recordings', () => {
    expect(deleteTuneMessage('Cluck Old Hen', [])).toBe(
      'Delete "Cluck Old Hen"? This removes its links and list entries.',
    )
  })

  it('counts a single recording in the singular', () => {
    expect(deleteTuneMessage('Cluck Old Hen', [view('uploaded')])).toBe(
      'Delete "Cluck Old Hen"? This removes its links, list entries, and 1 recording.',
    )
  })

  it('counts several recordings in the plural', () => {
    expect(deleteTuneMessage('Cluck Old Hen', [view('uploaded'), view(null)])).toBe(
      'Delete "Cluck Old Hen"? This removes its links, list entries, and 2 recordings.',
    )
  })

  it('warns when any recording has not uploaded', () => {
    expect(deleteTuneMessage('Cluck Old Hen', [view('downloaded'), view('failed_upload')])).toBe(
      'Delete "Cluck Old Hen"? This removes its links, list entries, and 2 recordings. Some recordings have not uploaded, so they cannot be recovered.',
    )
  })
})

describe('deleteTunesMessage', () => {
  it('speaks of the selection rather than one tune', () => {
    expect(deleteTunesMessage('12 tunes', [])).toBe(
      'Delete 12 tunes? This removes their links and list entries.',
    )
  })

  it('counts the recordings the whole selection takes with it', () => {
    expect(deleteTunesMessage('2 tunes', [view('uploaded'), view('downloaded')])).toBe(
      'Delete 2 tunes? This removes their links, list entries, and 2 recordings.',
    )
  })

  it('warns when any recording in the selection has not uploaded', () => {
    expect(deleteTunesMessage('2 tunes', [view('uploaded'), view('captured')])).toBe(
      'Delete 2 tunes? This removes their links, list entries, and 2 recordings. Some recordings have not uploaded, so they cannot be recovered.',
    )
  })
})
