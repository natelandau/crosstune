import {
  FolderInput,
  FolderOutput,
  Pencil,
  Scissors,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { deleteRecording, retryUpload, updateRecording } from '../../commands/recordings'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { DELETE, useConfirm } from '../../ui/Confirm'
import type { MenuItem } from '../../ui/Menu'
import type { RowAction } from '../../ui/Row'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { TRIM } from '../recording-screen/TrimView'
import { EDIT_RECORDING, useRecordingScreen } from '../recording-screen/useRecordingScreen'
import { RENAME } from './recordingCopy'
import { deleteRecordingMessage } from './recordingRow'
import type { RecordingView } from './useRecordings'

export const DELETE_RECORDING_TITLE = 'Delete this recording?'
export const REMOVE_FROM_TUNE = 'Remove from tune'
export const ADD_TO_TUNE = 'Add to tune'

export interface RecordingActions {
  /** One line for every refusal a list of recordings can report, wherever the control sits. */
  error: string | null
  /** Takes an upload's refusal, and null as a fresh pick clears whatever the line held. */
  setUploadError: (message: string | null) => void
  /** Runs any other mutation the same list offers, reporting it on the same one line. */
  run: (action: () => Promise<unknown>) => void
  retry: (view: RecordingView, kind: 'upload' | 'transcode') => void
  /** A row's actions: open it in the recording screen, file or unfile it, delete it. */
  actionsFor: (view: RecordingView) => RowAction[]
  /** The recording screen's menu: trim it, rename it, file or unfile it, delete it. */
  menuFor: (view: RecordingView) => MenuItem[]
}

/**
 * What every list of recordings, and the recording screen, does to a recording: open it,
 * rename it, file it, delete it, unstick it.
 */
export function useRecordingActions({
  onRename,
  onTrim,
  trimBlocked,
  onAddToTune,
  onDeleted,
}: {
  /** Left out where nothing offers Rename; only the recording screen's menu does. */
  onRename?: (view: RecordingView) => void
  /** Left out where nothing offers Trim; only the recording screen's menu does, switching to
   * the trim view in place. */
  onTrim?: () => void
  /** Why Trim cannot be used right now; the menu shows it disabled with this reason. */
  trimBlocked?: string
  /** Runs once a confirmed delete is under way, for a screen that must go with its recording. */
  onDeleted?: () => void
  /** Left out by a list where every recording is already filed under the tune it belongs to. */
  onAddToTune?: (view: RecordingView) => void
}): RecordingActions {
  const db = useDb()
  const engine = useSyncEngine()
  const player = usePlayer()
  const recordingScreen = useRecordingScreen()
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
      title: DELETE_RECORDING_TITLE,
      message: deleteRecordingMessage(view),
      action: DELETE,
    })
    if (!ok) return
    const id = view.recording.id
    // The player keeps whatever it loaded, so the row's audio has to leave it before the blob
    // goes, or it would sit on a source nothing can serve.
    if (isPlaying(player, { kind: 'recording', id })) player.close()
    onDeleted?.()
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
    if (view.tuneId) {
      return {
        label: REMOVE_FROM_TUNE,
        short: 'Remove',
        icon: FolderOutput,
        tone: 'warning',
        onPress: () => run(() => updateRecording(db, view.recording.id, { tune_id: null })),
      }
    }
    if (!onAddToTune) return null
    return {
      label: ADD_TO_TUNE,
      short: 'Add',
      icon: FolderInput,
      tone: 'warning',
      onPress: () => onAddToTune(view),
    }
  }

  const deleteAction = (view: RecordingView): RowAction => ({
    label: DELETE,
    icon: Trash2,
    tone: 'error',
    onPress: () => void remove(view),
  })

  const actionsFor = (view: RecordingView): RowAction[] => {
    const file = filing(view)
    return [
      {
        label: EDIT_RECORDING,
        icon: SlidersHorizontal,
        tone: 'neutral',
        onPress: () => recordingScreen.open(view.recording.id),
      },
      ...(file ? [file] : []),
      deleteAction(view),
    ]
  }

  const menuFor = (view: RecordingView): MenuItem[] => {
    const file = filing(view)
    return [
      ...(onTrim
        ? [
            {
              label: TRIM,
              icon: Scissors,
              tone: 'neutral' as const,
              disabled: trimBlocked,
              onPress: onTrim,
            },
          ]
        : []),
      ...(onRename
        ? [{ label: RENAME, icon: Pencil, tone: 'neutral' as const, onPress: () => onRename(view) }]
        : []),
      ...(file ? [file] : []),
      deleteAction(view),
    ]
  }

  return {
    error: uploadError ?? actionError,
    setUploadError: takeUploadError,
    run,
    retry,
    actionsFor,
    menuFor,
  }
}
