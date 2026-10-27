import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import {
  ADD_SCANS,
  CHOOSE_SCAN_FILES,
  deleteScanName,
  DONE_EDITING_SCANS,
  EDIT,
  EDIT_SCANS,
  moveScanName,
  openScanName,
  SCAN_LIMIT_NOTE,
  scanName,
  SCANS,
  SUBSCRIBE_TO_OPEN,
} from '../scans/scanCopy'
import type { ScanViewOrigin } from '../scans/scanViewLog'
import { useScansEditor } from '../scans/useScansEditor'
import { DELETE, DONE } from '../../ui/confirmCopy'
import { ScanViewer } from '../scans/ScanViewer'
import { usePremiumSheet } from '../plan/PremiumSheetProvider'
import { Button } from '../../ui/Button'
import { useConfirm } from '../../ui/Confirm'
import { useReorderAnnouncer } from '../../ui/reorder'
import { Row, type RowAction } from '../../ui/Row'
import { RowList } from '../../ui/RowList'
import { moveActions } from '../../ui/sharedActions'
import { PRESS } from '../../ui/press'
import { ScanThumbnail } from './ScanThumbnail'

const TUNE_PAGE: ScanViewOrigin = { context: 'tune' }
const ROW_THUMBNAIL_HEIGHT = 36

export interface TuneScansParts {
  /** True once the scans have read. */
  loaded: boolean
  /** True once the scans have read and there is at least one. */
  has: boolean
  /** Starts adding scans: the file picker, or the Plan sheet on a plan that does not open them. */
  add: () => void
  /** True while an add is running. */
  adding: boolean
  /** Edit or Done, then Add, for the heading of the section that shows the scans. */
  controls: ReactNode
  /** The thumbnails, or their rows while editing, with the limit note. */
  content: ReactNode
  /** Why the last add, move, or delete failed, which can follow a first add that left no
   * scans. */
  error: string | null
  /** The hidden file picker, the reorder announcer, and the viewer, mounted with or without
   * scans so Add works from anywhere on the page. */
  overlays: ReactNode
}

/**
 * A tune's scans as a row of thumbnails that open the viewer, with Add taking image files from
 * the device. Edit turns them into rows to reorder and delete. On a plan that does not open
 * scans, the thumbnails are dimmed, they and Add open the Plan sheet, and edit only deletes.
 * The page places each part, so Add can sit in a heading or in the page's add line.
 */
export function useTuneScans(tuneId: string): TuneScansParts {
  const confirm = useConfirm()
  const premium = usePremiumSheet()
  const lockedId = useId()
  const {
    opens,
    scans,
    files,
    editing,
    setEditing,
    viewing,
    setViewing,
    move,
    moveItems,
    announcement,
    add,
    adding,
    full,
    empty,
    loaded,
    remove,
    error,
    statusLabel,
  } = useScansEditor(tuneId, { confirm })
  const picker = useRef<HTMLInputElement>(null)
  const { announce, region } = useReorderAnnouncer()
  useEffect(() => {
    if (announcement) announce(announcement)
  }, [announcement, announce])
  const editingNow = editing && !empty
  const indexOf = (key: unknown) => scans.findIndex((scan) => scan.id === String(key))
  const start = () => {
    if (opens) picker.current?.click()
    else premium.open('scans', 'add_scan')
  }

  const controls = (
    <span className="flex items-center gap-1">
      {!empty && (
        <Button
          label={editingNow ? DONE : EDIT}
          name={editingNow ? DONE_EDITING_SCANS : EDIT_SCANS}
          onPress={() => setEditing(!editingNow)}
        />
      )}
      <Button icon={Plus} label={ADD_SCANS} iconOnly isDisabled={full || adding} onPress={start} />
    </span>
  )

  const content = (
    <>
      {!empty &&
        (editingNow ? (
          <RowList
            label={SCANS}
            bleed
            onReorder={
              opens
                ? (key, toIndex) => {
                    const from = indexOf(key)
                    if (from >= 0) move(from, toIndex)
                  }
                : undefined
            }
            moveLabel={opens ? ({ id }) => moveScanName(indexOf(id)) : undefined}
          >
            {scans.map((scan, at) => {
              const status = statusLabel(scan)
              const deleteAction: RowAction = {
                id: 'delete',
                label: deleteScanName(at),
                shortLabel: DELETE,
                icon: Trash2,
                tone: 'danger',
                onAction: () => remove(scan),
              }
              return (
                <Row
                  key={scan.id}
                  id={scan.id}
                  textValue={status ? `${scanName(at)}, ${status}` : scanName(at)}
                  leading={
                    <span className="shrink-0 overflow-hidden rounded-(--radius-row)">
                      <ScanThumbnail
                        scan={scan}
                        file={files.get(scan.id)}
                        height={ROW_THUMBNAIL_HEIGHT}
                      />
                    </span>
                  }
                  title={scanName(at)}
                  detail={status}
                  actions={[deleteAction]}
                  menu={
                    opens ? [...moveActions(moveItems(scan, at)), deleteAction] : [deleteAction]
                  }
                />
              )
            })}
          </RowList>
        ) : (
          <ul aria-label={SCANS} className="flex gap-3 overflow-x-auto pb-1">
            {scans.map((scan, index) => (
              <li key={scan.id} data-scan-id={scan.id} className="shrink-0">
                <AriaButton
                  aria-label={opens ? openScanName(index) : scanName(index)}
                  aria-describedby={opens ? undefined : lockedId}
                  onPress={() => {
                    if (opens) setViewing(index)
                    else premium.open('scans', 'scan')
                  }}
                  data-lift
                  className={`block overflow-hidden rounded-(--radius-row) ${PRESS} ${
                    opens ? '' : 'opacity-60'
                  }`}
                >
                  <ScanThumbnail scan={scan} file={files.get(scan.id)} />
                </AriaButton>
              </li>
            ))}
          </ul>
        ))}
      {!opens && (
        <span id={lockedId} hidden>
          {SUBSCRIBE_TO_OPEN}
        </span>
      )}
      {full && <p className="t-secondary text-secondary pt-2">{SCAN_LIMIT_NOTE}</p>}
    </>
  )

  const overlays = (
    <>
      {/* The native picker cannot be relabeled or sized, so it hides behind Add and stays out
          of the tab order, with its own name for anyone reading the tree. */}
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        aria-label={CHOOSE_SCAN_FILES}
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length > 0) void add(files)
        }}
      />
      {region}
      <ScanViewer
        tuneId={tuneId}
        startIndex={viewing ?? 0}
        origin={TUNE_PAGE}
        isOpen={viewing !== null}
        onOpenChange={(open) => {
          if (!open) setViewing(null)
        }}
      />
    </>
  )

  return {
    loaded,
    has: loaded && !empty,
    add: start,
    adding,
    error,
    controls,
    content,
    overlays,
  }
}
