import {
  ArrowRight,
  ExternalLink,
  FolderInput,
  FolderOutput,
  Pencil,
  Scissors,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { deleteRecording, retryUpload, updateRecording } from '../../commands/recordings'
import { setPlaySource } from '../../commands/tunes'
import { useAction } from '../../ui/useAction'
import { useLatest } from '../../ui/useLatest'
import { useDb } from '../../db/DbProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { DELETE } from '../../ui/confirmCopy'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import type { MenuItem } from '../../ui/menuTypes'
import type { RowAction } from '../../ui/rowTypes'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { pinRowAction } from '../tune/playSourceText'
import { TRIM } from '../practice/trimCopy'
import { openOn, EDIT, ADD_TO_TUNE } from './recordingCopy'
import { GO_TO_TUNE } from './recordingNames'
import { deleteRecordingMessage, originLink } from './recordingRow'
import type { RecordingView } from './useRecordings'

export const DELETE_RECORDING_TITLE = 'Delete this recording?'
export const REMOVE_FROM_TUNE = 'Remove from tune'

export interface RecordingActions {
  /** One line for every refusal a list of recordings can report, wherever the control sits. */
  error: string | null
  /** True while a row action is in flight. */
  pending: boolean
  /** Takes an upload's refusal, and null as a fresh pick clears whatever the line held. */
  setUploadError: (message: string | null) => void
  /** Runs any other mutation the same list offers, reporting it on the same one line. */
  run: (action: () => Promise<unknown>) => void
  retry: (view: RecordingView, kind: 'upload' | 'transcode') => void
  /** A row's actions: edit it, file or unfile it, delete it. */
  actionsFor: (view: RecordingView) => RowAction[]
  /**
   * Practice's menu: trim it, edit it, file or unfile it, go to its tune, open it
   * on the site it came from, delete it.
   */
  menuFor: (view: RecordingView) => MenuItem[]
}

export interface RecordingActionsOptions {
  /** Names what the list shows. A refusal that lands after it changes is dropped rather than
   * shown against the next subject. */
  subject?: unknown
  /** Left out where nothing offers Edit. */
  onEdit?: (view: RecordingView) => void
  /** Left out where nothing offers Trim; only practice's menu does, switching to
   * the trim view in place. */
  onTrim?: () => void
  /** Why Trim cannot be used right now; the menu shows it disabled with this reason. */
  trimBlocked?: string
  /** Runs once a confirmed delete is under way, for practice, which must go with its recording. */
  onDeleted?: () => void
  /** Left out by a list where every recording is already filed under the tune it belongs to. */
  onAddToTune?: (view: RecordingView) => void
  /** Left out where nothing offers Go to tune; a filed recording's row opens its tune. */
  onOpenTune?: (view: RecordingView) => void
  /** Left out where nothing offers pinning; only a tune's own list does. */
  pin?: { userTuneId: string; recordingId: string | null }
}

/**
 * What every list of recordings, and practice, does to a recording: edit it,
 * file it, delete it, unstick it. The caller supplies the confirmation.
 */
export function useRecordingActionsWith({
  confirm,
  subject,
  onEdit,
  onTrim,
  trimBlocked,
  onAddToTune,
  onOpenTune,
  onDeleted,
  pin,
}: RecordingActionsOptions & {
  confirm: (question: ConfirmQuestion) => Promise<boolean>
}): RecordingActions {
  const db = useDb()
  const engine = useSyncEngine()
  const player = usePlayer()
  const { error: actionError, pending, run: runAction, clear: clearAction } = useAction()
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Both sources feed one line, so whichever of them reports next owns it outright. Clearing
  // only its own source would let the other one's older refusal surface behind it.
  const takeUploadError = (message: string | null) => {
    setUploadError(message)
    clearAction()
  }

  const subjectRef = useLatest(subject)
  const run = (action: () => Promise<unknown>) => {
    const mine = subjectRef.current
    setUploadError(null)
    runAction(async () => {
      try {
        await action()
      } catch (caught) {
        if (Object.is(subjectRef.current, mine)) throw caught
      }
    })
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

  const goToTuneAction = (view: RecordingView): RowAction | null =>
    onOpenTune && view.tuneId
      ? { label: GO_TO_TUNE, icon: ArrowRight, tone: 'neutral', onPress: () => onOpenTune(view) }
      : null

  const deleteAction = (view: RecordingView): RowAction => ({
    label: DELETE,
    icon: Trash2,
    tone: 'error',
    onPress: () => void remove(view),
  })

  const editAction = (view: RecordingView): RowAction | null =>
    onEdit ? { label: EDIT, icon: Pencil, tone: 'neutral', onPress: () => onEdit(view) } : null

  const openOriginAction = (view: RecordingView): RowAction | null => {
    const link = originLink(view.recording)
    if (!link) return null
    const { site, url } = link
    return {
      label: openOn(site),
      icon: ExternalLink,
      tone: 'neutral',
      onPress: () => window.open(url, '_blank', 'noopener,noreferrer'),
    }
  }

  const pinAction = (view: RecordingView): RowAction | null => {
    if (!pin) return null
    const id = view.recording.id
    const pinned = pin.recordingId === id
    return pinRowAction(pinned, () =>
      run(() => setPlaySource(db, pin.userTuneId, pinned ? null : { kind: 'recording', id })),
    )
  }

  const actionsFor = (view: RecordingView): RowAction[] =>
    [
      editAction(view),
      filing(view),
      goToTuneAction(view),
      pinAction(view),
      deleteAction(view),
    ].filter((action): action is RowAction => action !== null)

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
      ...[editAction(view), file, goToTuneAction(view), openOriginAction(view)].filter(
        (action): action is RowAction => action !== null,
      ),
      deleteAction(view),
    ]
  }

  return {
    error: uploadError ?? actionError,
    pending,
    setUploadError: takeUploadError,
    run,
    retry,
    actionsFor,
    menuFor,
  }
}
