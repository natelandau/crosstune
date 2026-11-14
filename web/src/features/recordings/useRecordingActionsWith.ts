import { ArrowRight, ExternalLink, Scissors, SquareSplitHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useRecordingsPlayable } from '../../billing/usePlan'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { recordingOrigin } from '../../usage/origin'
import { deleteRecording, retryUpload } from '../../commands/recordings'
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
import { DELETE_WHILE_SPLITTING, SPLIT } from '../practice/splitCopy'
import { openOn } from './recordingCopy'
import { GO_TO_TUNE } from './recordingNames'
import { deleteRecordingMessage, originLink } from './recordingRow'
import type { RecordingView } from './useRecordings'
import { openExternal } from '../../platform/openExternal'

const DELETE_RECORDING_TITLE = 'Delete this recording?'

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
  /** A row's swipe, hover, and menu actions: Delete alone, since the row opens the
   * recording's page. */
  actionsFor: (view: RecordingView) => RowAction[]
  /**
   * The recording page's menu: trim it, split it, pin it, go to its tune, open it on the site
   * it came from, export it, delete it. Split is also the way a recording that must be split
   * to upload gets there.
   */
  pageMenuFor: (view: RecordingView) => MenuItem[]
}

export interface RecordingActionsOptions {
  /** Names what the list shows. A refusal that lands after it changes is dropped rather than
   * shown against the next subject. */
  subject?: unknown
  /** Left out where nothing offers Trim; only the recording page's menu does,
   * switching to the trim view in place. */
  onTrim?: () => void
  /** Why Trim cannot be used right now; the menu shows it disabled with this reason. */
  trimBlocked?: string
  /** Left out where nothing offers Split; only the recording page's menu does. */
  onSplit?: () => void
  /** Why Split cannot be used right now; the menu shows it disabled with this reason. */
  splitBlocked?: string
  /** Left out where nothing offers Go to tune; only the recording page's menu does. */
  onOpenTune?: (view: RecordingView) => void
  /** Left out where nothing offers pinning, such as an unfiled recording's page. */
  pin?: { userTuneId: string; recordingId: string | null }
  /** Left out where nothing offers export; only the recording page's menu does. */
  exportItems?: (view: RecordingView) => MenuItem[]
}

/**
 * What every list of recordings, and the recording page, does to a recording: delete it and
 * unstick it, and on the page trim, split, pin, and export it, and go to its tune. A plan that
 * plays no recordings offers no Pin, Trim, or Split. The caller supplies the confirmation.
 */
export function useRecordingActionsWith({
  confirm,
  subject,
  onTrim: offeredTrim,
  trimBlocked,
  onSplit: offeredSplit,
  splitBlocked,
  onOpenTune,
  pin: offeredPin,
  exportItems,
}: RecordingActionsOptions & {
  confirm: (question: ConfirmQuestion) => Promise<boolean>
}): RecordingActions {
  const plays = useRecordingsPlayable()
  const onTrim = plays ? offeredTrim : undefined
  const onSplit = plays ? offeredSplit : undefined
  const pin = plays ? offeredPin : undefined
  const db = useDb()
  const analytics = useAnalytics()
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
    run(async () => {
      await deleteRecording(db, id)
      analytics.send('recording_deleted', {
        origin: recordingOrigin(view.recording),
        recording_id: id,
      })
    })
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

  const goToTuneAction = (view: RecordingView): RowAction | null =>
    onOpenTune && view.tuneId
      ? { label: GO_TO_TUNE, icon: ArrowRight, tone: 'neutral', onPress: () => onOpenTune(view) }
      : null

  // A piece still waiting for its cut plays from its parent's audio.
  const deleteAction = (view: RecordingView): RowAction => ({
    label: DELETE,
    icon: Trash2,
    tone: 'error',
    disabled: view.holdsSplitAudio ? DELETE_WHILE_SPLITTING : undefined,
    onPress: () => void remove(view),
  })

  const openOriginAction = (view: RecordingView): RowAction | null => {
    const link = originLink(view.recording)
    if (!link) return null
    const { site, url } = link
    return {
      label: openOn(site),
      icon: ExternalLink,
      tone: 'neutral',
      onPress: () => openExternal(url),
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

  const actionsFor = (view: RecordingView): RowAction[] => [deleteAction(view)]

  const pageMenuFor = (view: RecordingView): MenuItem[] => {
    return [
      ...[pinAction(view), goToTuneAction(view), openOriginAction(view)].filter(
        (action): action is RowAction => action !== null,
      ),
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
      ...(onSplit
        ? [
            {
              label: SPLIT,
              icon: SquareSplitHorizontal,
              tone: 'neutral' as const,
              disabled: splitBlocked,
              onPress: onSplit,
            },
          ]
        : []),
      ...(exportItems?.(view) ?? []),
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
    pageMenuFor,
  }
}
