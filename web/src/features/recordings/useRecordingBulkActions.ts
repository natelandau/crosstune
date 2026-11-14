import { Download, Link, Share, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useRecordingsPlayable } from '../../billing/usePlan'
import { deleteRecordings, linkRecordings, waitingParentIds } from '../../commands/recordings'
import { holdsSplitAudio } from '../../domain/recordingLimits'
import { useDb } from '../../db/DbProvider'
import { useOnline } from '../../sync/SyncProvider'
import { localTimeZone } from '../../text/localDate'
import { DELETE } from '../../ui/confirmCopy'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import { useAction } from '../../ui/useAction'
import { useLatest } from '../../ui/useLatest'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { recordingOrigin } from '../../usage/origin'
import { usePremiumSheet } from '../plan/PremiumSheetProvider'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { DELETE_WHILE_SPLITTING } from '../practice/splitCopy'
import type { SelectionButton } from '../selection/selectionButton'
import { useCreateTune } from '../tune/useCreateTune'
import { exportLeftOut, SHARE } from './export/exportCopy'
import { exportReadiness } from './export/readiness'
import { canShareSelection } from './export/runRecordingExport'
import type { RecordingExportSheetProps } from './export/RecordingExportSheet'
import { useRecordingExportSheet } from './export/useRecordingExportSheet'
import { DOWNLOAD } from './recordingNames'
import { LINK_TO_TUNE, linkedRecordingsToast } from './recordingsCopy'
import { bulkDeleteQuestion } from './recordingRow'
import { reportRecordingFiled } from './reportRecordingFiled'
import type { RecordingView } from './useRecordings'

export interface RecordingBulkActionsOptions {
  /** Whether the selection mode is on; leaving it drops the last failure, any export, and any sheet. */
  active: boolean
  /** The selected recordings, in screen order. */
  views: readonly RecordingView[]
  onExit: () => void
  confirm: (question: ConfirmQuestion) => Promise<boolean>
  toast: (message: string, undo?: () => void) => void
}

export interface RecordingBulkActions {
  /** The selection bar's buttons: Link to tune, Download, Share where it can, then Delete. */
  buttons: SelectionButton[]
  /** A failed write, for the screen to show beside its bar. */
  error: string | null
  /** Whether the Link to tune sheet is open. */
  linkOpen: boolean
  closeLink: () => void
  /** Links the selection to the tune picked. */
  link: (tune: { id: string; title: string }) => void
  /** Creates a tune titled `title` and links the selection to it. */
  linkNew: (title: string) => void
  exporting: RecordingExportSheetProps
}

/**
 * The Recordings screen's bulk actions. A write applies to the whole selection and ends the
 * mode, while a failure keeps both so it can be tried again. Link to tune toasts with Undo,
 * and on a free plan opens the Plan sheet instead. Delete asks first, since no undo brings a
 * recording back, and leaves a split parent whose piece still plays from its audio. Download
 * first says which recordings it must leave out; an export ends the mode once delivered, and a
 * cancel keeps it.
 */
export function useRecordingBulkActions({
  active,
  views,
  onExit,
  confirm,
  toast,
}: RecordingBulkActionsOptions): RecordingBulkActions {
  const db = useDb()
  const analytics = useAnalytics()
  const player = usePlayer()
  const createTune = useCreateTune()
  const premium = usePremiumSheet()
  const playable = useRecordingsPlayable()
  const bar = useAction()
  const [linkOpen, setLinkOpen] = useState(false)
  const ids = useMemo(() => views.map((view) => view.recording.id), [views])
  const online = useOnline()
  const recordingExport = useRecordingExportSheet({
    onDone: (leftOut) => {
      if (leftOut > 0) toast(exportLeftOut(leftOut))
      onExit()
    },
  })
  const exportItems = useMemo(
    () => views.map((view) => ({ view, readiness: exportReadiness(view, online) })),
    [views, online],
  )
  const shareable = useMemo(() => canShareSelection(exportItems, localTimeZone()), [exportItems])
  const resetRef = useLatest(() => {
    setLinkOpen(false)
    recordingExport.sheet.onCancel()
    bar.clear()
  })
  useEffect(() => {
    if (!active) resetRef.current()
  }, [active, resetRef])

  const linkTo = async (tuneId: string, title: string) => {
    const { moved, undo } = await linkRecordings(db, ids, tuneId)
    for (const row of moved) reportRecordingFiled(analytics, row, tuneId)
    toast(linkedRecordingsToast(ids.length, title), undo)
  }

  const confirmDelete = async () => {
    // A parent stays only while a piece outside this delete waits on it, as `deleteRecordings`
    // decides.
    const waiting = await waitingParentIds(db, new Set(ids))
    const deletes = (view: RecordingView) => !holdsSplitAudio(view.recording, waiting)
    const held = views.filter((view) => !deletes(view)).length
    const ok = await confirm({ ...bulkDeleteQuestion(views, held), action: DELETE })
    if (!ok) return
    // The player keeps whatever it loaded, so a recording must leave it before its blob goes.
    if (
      views.some(
        (view) => deletes(view) && isPlaying(player, { kind: 'recording', id: view.recording.id }),
      )
    ) {
      player.close()
    }
    void bar.attempt(async () => {
      const { deleted } = await deleteRecordings(db, ids)
      const byId = new Map(views.map((view) => [view.recording.id, view.recording]))
      for (const id of deleted) {
        analytics.send('recording_deleted', {
          origin: recordingOrigin(byId.get(id)!),
          recording_id: id,
        })
      }
    }, onExit)
  }

  const allHeld = views.length > 0 && views.every((view) => view.holdsSplitAudio)
  const buttons: SelectionButton[] = [
    {
      id: 'link',
      label: LINK_TO_TUNE,
      icon: Link,
      onPress: playable
        ? () => setLinkOpen(true)
        : () => premium.open('recordings', 'link_recordings'),
    },
    {
      id: 'download',
      label: DOWNLOAD,
      icon: Download,
      onPress: () => recordingExport.download(exportItems),
    },
    ...(shareable
      ? [
          {
            id: 'share',
            label: SHARE,
            icon: Share,
            onPress: () => recordingExport.exportMany(views, 'share'),
          },
        ]
      : []),
    {
      id: 'delete',
      label: DELETE,
      icon: Trash2,
      disabled: allHeld ? DELETE_WHILE_SPLITTING : undefined,
      onPress: () => void confirmDelete(),
    },
  ]

  return {
    buttons,
    error: bar.error ?? recordingExport.error,
    linkOpen,
    closeLink: () => setLinkOpen(false),
    link: ({ id, title }) => void bar.attempt(() => linkTo(id, title), onExit),
    linkNew: (title) =>
      void bar.attempt(async () => {
        const created = await createTune({ title, source: 'recordings_list' })
        await linkTo(created.tuneId, created.title)
      }, onExit),
    exporting: recordingExport.sheet,
  }
}
