import { describe, expect, it } from 'vitest'
import type { LocalFileState, RecordingFile } from '../../db/recordings'
import type { RecordingView } from '../recordings/useRecordings'
import { deleteSongMessage } from './deleteSongMessage'

// The message reads only each recording's file state, so the rest of the view is left out.
function view(state: LocalFileState | null): RecordingView {
  const file = state ? ({ local_state: state } as RecordingFile) : undefined
  return { file } as RecordingView
}

describe('deleteSongMessage', () => {
  it('names only links and list entries when there are no recordings', () => {
    expect(deleteSongMessage('Cluck Old Hen', [])).toBe(
      'Delete "Cluck Old Hen"? This removes its links and list entries.',
    )
  })

  it('counts a single recording in the singular', () => {
    expect(deleteSongMessage('Cluck Old Hen', [view('uploaded')])).toBe(
      'Delete "Cluck Old Hen"? This removes its links, list entries, and 1 recording.',
    )
  })

  it('counts several recordings in the plural', () => {
    expect(deleteSongMessage('Cluck Old Hen', [view('uploaded'), view(null)])).toBe(
      'Delete "Cluck Old Hen"? This removes its links, list entries, and 2 recordings.',
    )
  })

  it('warns when any recording has not uploaded', () => {
    expect(deleteSongMessage('Cluck Old Hen', [view('downloaded'), view('failed_upload')])).toBe(
      'Delete "Cluck Old Hen"? This removes its links, list entries, and 2 recordings. Some recordings have not uploaded, so they cannot be recovered.',
    )
  })
})
