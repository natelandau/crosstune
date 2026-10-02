import { IonButton } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useAuthSession } from '../../../auth/AuthContext'
import { useDb } from '../../../db/DbProvider'
import { CANCEL } from '../../../ui/Confirm'
import { InlineError } from '../../../ui/InlineError'
import { Sheet } from '../../../ui/Sheet'
import { useAction } from '../../../ui/useAction'
import {
  EXPORT_ACTION,
  EXPORT_COMPLETE_NOTE,
  EXPORT_TITLE,
  exportMissingNote,
  exportProgress,
} from './exportCopy'
import { createExport, downloadBlob, exportCounts } from './runExport'

/**
 * Zips the tunes, lists, and every recording this device holds into one download. Closing the
 * sheet by any route abandons an export in progress.
 */
export function ExportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useDb()
  const { userId } = useAuthSession()
  const { error, pending, runThen, clear } = useAction()
  const [closing, setClosing] = useState(false)
  const [openedFor, setOpenedFor] = useState(open)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const counts = useLiveQuery(() => (open ? exportCounts(db) : undefined), [db, open])

  // Reset during render so a reopened sheet never shows the last run's progress or error.
  if (open !== openedFor) {
    setOpenedFor(open)
    if (open) {
      setClosing(false)
      setProgress(null)
      clear()
    }
  }

  useEffect(() => () => controller.current?.abort(), [])

  const abandon = () => controller.current?.abort()

  const runExport = () => {
    if (controller.current) return
    const abort = new AbortController()
    controller.current = abort
    setProgress(null)
    let finished = false
    runThen(
      async () => {
        try {
          const { fileName, blob } = await createExport(db, userId, {
            now: new Date(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            signal: abort.signal,
            onProgress: (done, total) => {
              if (controller.current === abort) setProgress(total > 0 ? { done, total } : null)
            },
          })
          if (abort.signal.aborted) return
          downloadBlob(blob, fileName)
          finished = true
        } catch (cause) {
          if (abort.signal.aborted) return
          throw cause
        } finally {
          if (controller.current === abort) controller.current = null
        }
      },
      () => {
        if (finished) setClosing(true)
      },
    )
  }

  const note =
    counts && counts.onDevice < counts.total
      ? exportMissingNote(counts.onDevice, counts.total)
      : EXPORT_COMPLETE_NOTE

  return (
    <Sheet
      open={open && !closing}
      // Cancel is the way out mid-export, so a late dismiss cannot let a finished export download.
      dismissible={!pending}
      title={EXPORT_TITLE}
      onClose={() => {
        abandon()
        onClose()
      }}
      start={
        <IonButton
          onClick={() => {
            abandon()
            setClosing(true)
          }}
        >
          {CANCEL}
        </IonButton>
      }
    >
      <h2 className="type-headline m-0 px-(--form-inset) pt-(--form-gutter) text-center">
        {EXPORT_TITLE}
      </h2>
      {counts ? <p className="type-body px-(--form-inset) pt-(--form-text-gap)">{note}</p> : null}
      {pending && progress ? (
        <p className="type-body px-(--form-inset) pt-(--form-text-gap)" role="status">
          {exportProgress(progress.done, progress.total)}
        </p>
      ) : null}
      {error ? (
        <InlineError className="px-(--form-inset) pt-(--form-text-gap)">{error}</InlineError>
      ) : null}
      <div className="px-(--form-inset) pt-(--form-text-gap)">
        <IonButton type="button" expand="block" disabled={pending || !counts} onClick={runExport}>
          {EXPORT_ACTION}
        </IonButton>
      </div>
    </Sheet>
  )
}
