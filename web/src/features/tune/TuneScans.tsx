import { FileImage, ImageOff, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import type { ScanFile } from '../../db/scans'
import type { LocalScan } from '../../db/types'
import {
  ADD_SCANS,
  CHOOSE_SCAN_FILES,
  deleteScanName,
  DONE_EDITING_SCANS,
  EDIT,
  EDIT_SCANS,
  moveScanName,
  NO_SCANS,
  NO_SCANS_HINT,
  openScanName,
  SCAN_LIMIT_NOTE,
  SCAN_UNREADABLE,
  scanName,
  SCANS,
} from '../scans/scanCopy'
import { aspectRatio, useThumbnail } from '../scans/scanImages'
import type { ScanViewOrigin } from '../scans/scanViewLog'
import { THUMBNAIL_HEIGHT } from '../scans/thumbnail'
import { useScansEditor } from '../scans/useScansEditor'
import { DELETE, DONE } from '../../ui/confirmCopy'
import { ScanViewer } from '../scans/ScanViewer'
import { Button } from '../../ui/Button'
import { useConfirm } from '../../ui/Confirm'
import { ErrorLine } from '../../ui/ErrorLine'
import { useReorderAnnouncer } from '../../ui/reorder'
import { Row, type RowAction } from '../../ui/Row'
import { RowList } from '../../ui/RowList'
import { moveActions } from '../../ui/sharedActions'
import { PageSection } from '../../ui/PageSection'
import { SectionEmpty } from '../../ui/SectionEmpty'
import { PRESS } from '../../ui/press'

const TUNE_PAGE: ScanViewOrigin = { context: 'tune' }
const ROW_THUMBNAIL_HEIGHT = 36

/**
 * A tune's scans as a row of thumbnails that open the viewer, with Add taking image files from
 * the device. Edit turns them into rows to reorder and delete.
 */
export function TuneScans({ tuneId }: { tuneId: string }) {
  const confirm = useConfirm()
  const {
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

  return (
    <>
      <PageSection
        title={SCANS}
        add={
          <span className="flex items-center gap-1">
            {!empty && (
              <Button
                label={editingNow ? DONE : EDIT}
                name={editingNow ? DONE_EDITING_SCANS : EDIT_SCANS}
                onPress={() => setEditing(!editingNow)}
              />
            )}
            <Button
              icon={Plus}
              label={ADD_SCANS}
              iconOnly
              isDisabled={full || adding}
              onPress={() => picker.current?.click()}
            />
          </span>
        }
      >
        {empty && loaded && <SectionEmpty icon={FileImage} title={NO_SCANS} hint={NO_SCANS_HINT} />}
        {!empty &&
          (editingNow ? (
            <RowList
              label={SCANS}
              bleed
              onReorder={(key, toIndex) => {
                const from = indexOf(key)
                if (from >= 0) move(from, toIndex)
              }}
              moveLabel={({ id }) => moveScanName(indexOf(id))}
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
                        <Thumbnail
                          scan={scan}
                          file={files.get(scan.id)}
                          height={ROW_THUMBNAIL_HEIGHT}
                        />
                      </span>
                    }
                    title={scanName(at)}
                    detail={status}
                    actions={[deleteAction]}
                    menu={[...moveActions(moveItems(scan, at)), deleteAction]}
                  />
                )
              })}
            </RowList>
          ) : (
            <ul aria-label={SCANS} className="flex gap-3 overflow-x-auto pb-1">
              {scans.map((scan, index) => (
                <li key={scan.id} data-scan-id={scan.id} className="shrink-0">
                  <AriaButton
                    aria-label={openScanName(index)}
                    onPress={() => setViewing(index)}
                    data-lift
                    className={`block overflow-hidden rounded-(--radius-row) ${PRESS}`}
                  >
                    <Thumbnail scan={scan} file={files.get(scan.id)} />
                  </AriaButton>
                </li>
              ))}
            </ul>
          ))}
        {full && <p className="t-secondary text-ink-2 pt-2">{SCAN_LIMIT_NOTE}</p>}
        <ErrorLine error={error} place="inline" />
      </PageSection>
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
}

/** A scan at a fixed height: its image, a broken-scan mark, or a blank of its size. */
function Thumbnail({
  scan,
  file,
  height = THUMBNAIL_HEIGHT,
}: {
  scan: LocalScan
  file: ScanFile | undefined
  height?: number
}) {
  const thumbnail = useThumbnail(file, scan.height)
  const size = { height, width: height * aspectRatio(scan) }
  if (file && thumbnail.kind === 'ready') {
    return (
      <img src={thumbnail.url} alt="" className="ph-no-capture block object-contain" style={size} />
    )
  }
  return (
    <span className="bg-fill grid place-items-center" style={size}>
      {file && thumbnail.kind === 'broken' && (
        <>
          <ImageOff className="text-ink-2 size-6" aria-hidden />
          <span className="sr-only">{SCAN_UNREADABLE}</span>
        </>
      )}
    </span>
  )
}
