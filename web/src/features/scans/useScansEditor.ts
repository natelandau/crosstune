import { useState } from 'react'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { MAX_SCANS, moveScan } from '../../commands/scans'
import { useDb } from '../../db/DbProvider'
import { sortScans, type ScanFile } from '../../db/scans'
import type { LocalScan } from '../../db/types'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import type { MenuItem } from '../../ui/menuTypes'
import { useLatest } from '../../ui/useLatest'
import { moveMenuItems } from '../../ui/moveMenu'
import { useReplayedOrder } from '../lists/useReplayedOrder'
import { scanErrorLabel, scanMovedAnnouncement, SCAN_WAITING } from './scanCopy'
import { useAddScans } from './useAddScans'
import { useDeleteScan } from './useDeleteScan'
import { useScans } from './useScans'

const NO_SCANS: LocalScan[] = []
const NO_FILES = new Map<string, ScanFile>()
const scanIdOf = (scan: LocalScan) => scan.id

export interface ScansEditor {
  /** False until the first read of the tune's scans lands. */
  loaded: boolean
  /** The tune's scans in the order shown, with any move in flight already applied. */
  scans: LocalScan[]
  files: Map<string, ScanFile>
  editing: boolean
  setEditing: (editing: boolean) => void
  /** The index of the scan open in the viewer, or null while it is closed. */
  viewing: number | null
  setViewing: (index: number | null) => void
  /** Sends the scan at `from` to `to`, showing it there at once and writing it behind. */
  move: (from: number, to: number) => void
  /** The moves for the scan at `index`, each read against the rows on screen when pressed. */
  moveItems: (scan: LocalScan, index: number) => MenuItem[]
  /** What the last move said it did, for a status line. */
  announcement: string
  add: (files: File[]) => Promise<void>
  adding: boolean
  /** The tune holds `MAX_SCANS` and takes no more. */
  full: boolean
  empty: boolean
  /** Deletes a scan once the musician confirms. */
  remove: (scan: LocalScan) => void
  /** One line for whatever an add, a delete, or a move could not do. */
  error: string | null
  /** What a scan cannot show by its image alone: why it has not uploaded, or that it is still
   * to come. */
  statusLabel: (scan: LocalScan) => string | null
}

/**
 * A tune's scans as the tune screen edits them: reorder, add from the device, delete, and which
 * one the viewer has open. The caller supplies the confirmation.
 */
export function useScansEditor(
  tuneId: string,
  { confirm }: { confirm: (question: ConfirmQuestion) => Promise<boolean> },
): ScansEditor {
  const db = useDb()
  const analytics = useAnalytics()
  const data = useScans(tuneId)
  const files = data?.files ?? NO_FILES
  const [editing, setEditing] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const { error: deleteError, remove } = useDeleteScan({ confirm })
  const {
    ordered: scans,
    move,
    announcement,
  } = useReplayedOrder({
    items: data?.scans ?? NO_SCANS,
    idOf: scanIdOf,
    write: (scanId, targetId) => moveScan(db, scanId, targetId),
    readOrder: async () =>
      sortScans(
        (await db.scans.where('tune_id').equals(tuneId).toArray()).filter((row) => !row.deleted_at),
      ).map(scanIdOf),
    announce: (rows, from, to) => scanMovedAnnouncement(from, to, rows.length),
    onMoveStart: () => setMoveError(null),
    onMoved: () => analytics.send('scans_reordered', { tune_id: tuneId }),
    onError: setMoveError,
  })
  // The rows a menu item acts on are the ones on screen when it is pressed, not when it opened.
  const scansRef = useLatest(scans)
  const { adding, error: addError, add } = useAddScans(tuneId, scans.length)

  return {
    loaded: data !== undefined,
    scans,
    files,
    editing,
    setEditing,
    viewing,
    setViewing,
    move: (from, to) => move(scans, from, to),
    moveItems: (scan, index) =>
      moveMenuItems(index, scans.length, (place) => () => {
        const rows = scansRef.current
        const now = rows.findIndex((row) => row.id === scan.id)
        if (now >= 0) move(rows, now, place(now, rows.length - 1))
      }),
    announcement,
    add,
    adding,
    full: scans.length >= MAX_SCANS,
    empty: scans.length === 0,
    remove: (scan) => remove(scan, files.get(scan.id)),
    error: addError ?? deleteError ?? moveError,
    statusLabel: (scan) => {
      const file = files.get(scan.id)
      if (file) return scanErrorLabel(file)
      return scan.state === 'pending_upload' ? SCAN_WAITING : null
    },
  }
}
