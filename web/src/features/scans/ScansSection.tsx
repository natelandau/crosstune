import {
  IonButton,
  IonItem,
  IonLabel,
  IonReorder,
  IonReorderGroup,
  IonSpinner,
  type ReorderEndCustomEvent,
} from '@ionic/react'
import { ArrowUpDown, FileMusic, GripVertical, ImageOff, Plus, Trash2 } from 'lucide-react'
import { useId, useRef, useState, type MouseEvent } from 'react'
import { addScans, MAX_SCANS, moveScan } from '../../commands/scans'
import { useDb } from '../../db/DbProvider'
import { sortScans, type ScanFile } from '../../db/scans'
import type { LocalScan } from '../../db/types'
import { EmptyState } from '../../ui/EmptyState'
import { Group } from '../../ui/Group'
import { useMenu } from '../../ui/Menu'
import { messageFor } from '../../ui/useAction'
import { useLatest } from '../../ui/useLatest'
import { moveMenuItems } from '../lists/moveMenu'
import { useReplayedOrder } from '../lists/useReplayedOrder'
import { prepareImage, UndecodableImageError } from './prepareImage'
import {
  ADD_SCANS,
  deleteScanName,
  downloadingScanName,
  moveScanName,
  NO_SCANS_HINT,
  NO_SCANS_TITLE,
  openScanName,
  reorderScanName,
  SCAN_LIMIT_NOTE,
  SCAN_UNREADABLE,
  SCAN_WAITING,
  scanErrorLabel,
  scanName,
  SCANS,
  scansNotAddedMessage,
  unreadableFilesMessage,
} from './scanCopy'
import { aspectRatio, useThumbnail } from './scanImages'
import { ScanViewer } from './ScanViewer'
import type { ScanViewOrigin } from './scanViewLog'
import { THUMBNAIL_HEIGHT } from './thumbnail'
import { useDeleteScan } from './useDeleteScan'
import { useScans } from './useScans'

export const EDIT = 'Edit'
export const DONE = 'Done'
// The screen's toolbar carries its own Edit, for the tune, so this one names what it edits.
export const EDIT_SCANS = 'Edit scans'
export const DONE_EDITING_SCANS = 'Done editing scans'
/** The hidden file input's own name, for anyone reading the tree. */
export const CHOOSE_SCAN_FILES = 'Choose scan images'

const ROW_THUMBNAIL_HEIGHT = 44
const NO_SCANS: LocalScan[] = []
const scanIdOf = (scan: LocalScan) => scan.id
const TUNE_SCREEN: ScanViewOrigin = { context: 'tune' }

/**
 * A tune's scans: a row of thumbnails that open the viewer, and in edit mode a
 * list to reorder and delete them. Add takes image files from the device, each scaled and
 * re-encoded before it is stored.
 */
export function ScansSection({ tuneId }: { tuneId: string }) {
  const db = useDb()
  const data = useScans(tuneId)
  const openMenu = useMenu()
  const picker = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const { error: deleteError, remove } = useDeleteScan()
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
    announce: (rows, from, to) => `${scanName(from)} moved to ${to + 1} of ${rows.length}`,
    onMoveStart: () => setMoveError(null),
    onError: setMoveError,
  })
  // The rows a menu item acts on are the ones on screen when it is pressed, not when it opened.
  const scansRef = useLatest(scans)

  if (data === undefined) return null

  const empty = scans.length === 0
  const full = scans.length >= MAX_SCANS

  const addFiles = async (files: File[]) => {
    setAdding(true)
    setAddError(null)
    const unreadable: string[] = []
    let room = MAX_SCANS - scansRef.current.length
    let skipped = 0
    let failure: string | null = null
    try {
      // One at a time and in the order picked, so each scan shows as soon as it is ready and a
      // pick past the limit stops where the tune is full.
      for (const file of files) {
        if (room <= 0) {
          skipped++
          continue
        }
        let prepared
        try {
          prepared = await prepareImage(file)
        } catch (caught) {
          if (!(caught instanceof UndecodableImageError)) throw caught
          unreadable.push(file.name)
          continue
        }
        await addScans(db, tuneId, [prepared])
        room--
      }
    } catch (caught) {
      failure = messageFor(caught)
    } finally {
      const said = [
        unreadable.length > 0 ? unreadableFilesMessage(unreadable) : null,
        skipped > 0 ? scansNotAddedMessage(skipped) : null,
        failure,
      ].filter((line) => line !== null)
      setAddError(said.length > 0 ? said.join(' ') : null)
      setAdding(false)
    }
  }

  const moveMenu = (event: MouseEvent, scan: LocalScan, at: number) => {
    const items = moveMenuItems(at, scans.length, (place) => () => {
      const rows = scansRef.current
      const now = rows.findIndex((row) => row.id === scan.id)
      if (now >= 0) move(rows, now, place(now, rows.length - 1))
    })
    if (items.length > 0) openMenu(event, moveScanName(at), items)
  }

  const actions = (
    <>
      {empty ? null : (
        <IonButton
          fill="clear"
          className="section-action"
          aria-label={editing ? DONE_EDITING_SCANS : EDIT_SCANS}
          onClick={() => setEditing(!editing)}
        >
          {editing ? DONE : EDIT}
        </IonButton>
      )}
      <IonButton
        fill="clear"
        className="section-action"
        aria-label={ADD_SCANS}
        disabled={full || adding}
        onClick={() => picker.current?.click()}
      >
        <Plus aria-hidden="true" className="size-6" />
      </IonButton>
    </>
  )

  return (
    <>
      <Group
        header={SCANS}
        name={SCANS}
        actions={actions}
        plain={empty || !editing}
        error={addError ?? deleteError ?? moveError}
        footer={full ? SCAN_LIMIT_NOTE : undefined}
      >
        {empty ? (
          <EmptyState compact icon={FileMusic} title={NO_SCANS_TITLE} hint={NO_SCANS_HINT} />
        ) : editing ? (
          <IonReorderGroup
            disabled={scans.length < 2}
            onIonReorderEnd={(event: ReorderEndCustomEvent) => {
              const { from, to } = event.detail
              // React's own order stands, so Ionic must leave the DOM alone.
              event.detail.complete(false)
              move(scans, from, to)
            }}
          >
            {scans.map((scan, at) => {
              const file = data.files.get(scan.id)
              return (
                <IonItem key={scan.id} data-scan-id={scan.id}>
                  <div slot="start" className="py-1">
                    <ScanThumbnail
                      scan={scan}
                      file={file}
                      index={at}
                      height={ROW_THUMBNAIL_HEIGHT}
                    />
                  </div>
                  <IonLabel>
                    <h3>{scanName(at)}</h3>
                    <StatusLine scan={scan} file={file} />
                  </IonLabel>
                  <div slot="end" className="flex items-center">
                    <IonButton
                      fill="clear"
                      color="danger"
                      className="section-action"
                      aria-label={deleteScanName(at)}
                      onClick={() => remove(scan, file)}
                    >
                      <Trash2 aria-hidden="true" className="size-5" />
                    </IonButton>
                    {scans.length > 1 ? (
                      <>
                        {/* The grip swallows every click, so the same moves sit behind a
                            button a keyboard and a screen reader can reach. */}
                        <button
                          type="button"
                          aria-label={reorderScanName(at)}
                          className="grid size-11 place-items-center"
                          onClick={(event) => moveMenu(event, scan, at)}
                        >
                          <ArrowUpDown aria-hidden="true" className="size-5" />
                        </button>
                        <IonReorder className="size-11 p-3">
                          <GripVertical aria-hidden="true" className="size-5" />
                        </IonReorder>
                      </>
                    ) : null}
                  </div>
                </IonItem>
              )
            })}
          </IonReorderGroup>
        ) : (
          <ul
            aria-label={SCANS}
            className="m-0 flex list-none gap-3 overflow-x-auto px-(--form-inset) py-1"
          >
            {scans.map((scan, at) => (
              <ScanTile
                key={scan.id}
                scan={scan}
                file={data.files.get(scan.id)}
                index={at}
                onOpen={() => setViewing(at)}
              />
            ))}
          </ul>
        )}
      </Group>
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
          if (files.length > 0) void addFiles(files)
        }}
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {viewing !== null ? (
        <ScanViewer
          tuneId={tuneId}
          startIndex={viewing}
          origin={TUNE_SCREEN}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  )
}

/** What a scan cannot show by its image alone: why it has not uploaded, or that it is still to
 * come. */
function statusLabel(scan: LocalScan, file: ScanFile | undefined): string | null {
  if (file) return scanErrorLabel(file)
  return scan.state === 'pending_upload' ? SCAN_WAITING : null
}

function StatusLine({ scan, file }: { scan: LocalScan; file: ScanFile | undefined }) {
  const label = statusLabel(scan, file)
  return label ? <p className="type-footnote">{label}</p> : null
}

function ScanTile({
  scan,
  file,
  index,
  onOpen,
}: {
  scan: LocalScan
  file: ScanFile | undefined
  index: number
  onOpen: () => void
}) {
  const label = statusLabel(scan, file)
  const labelId = useId()
  const brokenId = useId()
  const width = THUMBNAIL_HEIGHT * aspectRatio(scan)
  return (
    <li
      data-scan-id={scan.id}
      className="flex shrink-0 flex-col gap-1"
      // A note under a narrow scan widens its column rather than standing one word to a line.
      style={{ width: label ? Math.max(width, 128) : width }}
    >
      <button
        type="button"
        aria-label={openScanName(index)}
        // The name stands in for the button's contents, so a broken scan's note is pointed at;
        // an id with no element behind it is ignored.
        aria-describedby={label ? `${brokenId} ${labelId}` : brokenId}
        className="w-fit overflow-hidden rounded-md"
        onClick={onOpen}
      >
        <ScanThumbnail
          scan={scan}
          file={file}
          index={index}
          height={THUMBNAIL_HEIGHT}
          brokenId={brokenId}
        />
      </button>
      {label ? (
        <p id={labelId} className="type-caption m-0">
          {label}
        </p>
      ) : null}
    </li>
  )
}

/** A scan at a fixed height: its thumbnail, a broken-scan mark, or a placeholder of its size. */
function ScanThumbnail({
  scan,
  file,
  index,
  height,
  brokenId,
}: {
  scan: LocalScan
  file: ScanFile | undefined
  index: number
  height: number
  /** The id the broken-scan note takes, for a control that names itself. */
  brokenId?: string
}) {
  const thumbnail = useThumbnail(file, scan.height)
  const size = { height, width: height * aspectRatio(scan) }
  const surface = 'grid place-items-center bg-(--ion-background-color-step-100)'
  if (!file) {
    return (
      <div data-scan-placeholder className={surface} style={size}>
        {scan.state === 'ready' ? (
          <div role="status" aria-label={downloadingScanName(index)}>
            <IonSpinner aria-hidden="true" />
          </div>
        ) : null}
      </div>
    )
  }
  if (thumbnail.kind === 'broken') {
    return (
      <div className={surface} style={size}>
        <ImageOff aria-hidden="true" className="size-6 text-(--ion-color-medium)" />
        <span id={brokenId} className="sr-only">
          {SCAN_UNREADABLE}
        </span>
      </div>
    )
  }
  if (thumbnail.kind === 'loading') return <div className={surface} style={size} />
  return <img src={thumbnail.url} alt="" className="block object-contain" style={size} />
}
