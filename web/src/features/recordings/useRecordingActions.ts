import { FolderInput, FolderOutput, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { deleteRecording, retryUpload, updateRecording } from '../../commands/recordings'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { useConfirm } from '../../ui/Confirm'
import type { RowAction } from '../../ui/Row'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { deleteRecordingMessage } from './recordingRow'
import type { RecordingView } from './useRecordings'

export interface RecordingActions {
  /** One line for every refusal a list of recordings can report, wherever the control sits. */
  error: string | null
  /** Takes an upload's refusal, and null as a fresh pick clears whatever the line held. */
  setUploadError: (message: string | null) => void
  /** Runs any other mutation the same list offers, reporting it on the same one line. */
  run: (action: () => Promise<unknown>) => void
  retry: (view: RecordingView, kind: 'upload' | 'transcode') => void
  actionsFor: (view: RecordingView) => RowAction[]
}

/** What every list of recordings does to a row: rename it, file it, delete it, unstick it. */
export function useRecordingActions({
  onRename,
  onAddToSong,
}: {
  onRename: (view: RecordingView) => void
  /** Left out by a list where every recording is already filed under the song it belongs to. */
  onAddToSong?: (view: RecordingView) => void
}): RecordingActions {
  const db = useDb()
  const engine = useSyncEngine()
  const player = usePlayer()
  const confirm = useConfirm()
  const { error: actionError, run: runAction, clear: clearAction } = useAction()
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Both sources feed one line, so whichever of them reports next owns it outright. Clearing
  // only its own source would let the other one's older refusal surface behind it.
  const takeUploadError = (message: string | null) => {
    setUploadError(message)
    clearAction()
  }

  const run = (action: () => Promise<unknown>) => {
    setUploadError(null)
    runAction(action)
  }

  const remove = async (view: RecordingView) => {
    const ok = await confirm({
      title: 'Delete this recording?',
      message: deleteRecordingMessage(view),
      action: 'Delete',
    })
    if (!ok) return
    const id = view.recording.id
    // The player keeps whatever it loaded, so the row's audio has to leave it before the blob
    // goes, or it would sit on a source nothing can serve.
    if (isPlaying(player, { kind: 'recording', id })) player.close()
    run(() => deleteRecording(db, id))
  }

  const retry = (view: RecordingView, kind: 'upload' | 'transcode') => {
    const id = view.recording.id
    if (kind === 'transcode') {
      run(() => engine.retry(id))
      return
    }
    run(async () => {
      // The reset only puts the file back at the front of the queue; a pass is what sends it.
      await retryUpload(db, id)
      void engine.sync()
    })
  }

  const filing = (view: RecordingView): RowAction | null => {
    if (view.songId) {
      return {
        label: 'Remove from song',
        icon: FolderOutput,
        tone: 'warning',
        onPress: () => run(() => updateRecording(db, view.recording.id, { song_id: null })),
      }
    }
    if (!onAddToSong) return null
    return {
      label: 'Add to song',
      icon: FolderInput,
      tone: 'warning',
      onPress: () => onAddToSong(view),
    }
  }

  const actionsFor = (view: RecordingView): RowAction[] => {
    const file = filing(view)
    return [
      { label: 'Rename', icon: Pencil, tone: 'neutral', onPress: () => onRename(view) },
      ...(file ? [file] : []),
      { label: 'Delete', icon: Trash2, tone: 'error', onPress: () => void remove(view) },
    ]
  }

  return {
    error: uploadError ?? actionError,
    setUploadError: takeUploadError,
    run,
    retry,
    actionsFor,
  }
}
