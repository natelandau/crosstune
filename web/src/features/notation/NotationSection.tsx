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
import { addNotationPages, MAX_NOTATION_PAGES, moveNotationPage } from '../../commands/notation'
import { useDb } from '../../db/DbProvider'
import { sortPages, type NotationFile } from '../../db/notation'
import type { LocalNotationPage } from '../../db/types'
import { EmptyState } from '../../ui/EmptyState'
import { Group } from '../../ui/Group'
import { useMenu } from '../../ui/Menu'
import { messageFor } from '../../ui/useAction'
import { useLatest } from '../../ui/useLatest'
import { moveMenuItems } from '../lists/moveMenu'
import { useReplayedOrder } from '../lists/useReplayedOrder'
import {
  ADD_NOTATION,
  deletePageName,
  downloadingPageName,
  NO_NOTATION_HINT,
  NO_NOTATION_TITLE,
  NOTATION,
  NOTATION_LIMIT_NOTE,
  NOTATION_WAITING,
  openPageName,
  PAGE_UNREADABLE,
  pageErrorLabel,
  pageName,
  pagesNotAddedMessage,
  reorderPageName,
  unreadableFilesMessage,
} from './notationCopy'
import { NotationViewer } from './NotationViewer'
import { aspectRatio, THUMBNAIL_HEIGHT, useThumbnail } from './pageImages'
import { prepareImage, UndecodableImageError } from './prepareImage'
import { useDeletePage } from './useDeletePage'
import { useNotationPages } from './useNotationPages'

export const EDIT = 'Edit'
export const DONE = 'Done'
// The screen's toolbar carries its own Edit, for the tune, so this one names what it edits.
export const EDIT_NOTATION = 'Edit notation'
export const DONE_EDITING_NOTATION = 'Done editing notation'
/** The hidden file input's own name, for anyone reading the tree. */
export const CHOOSE_NOTATION_FILES = 'Choose notation images'

const ROW_THUMBNAIL_HEIGHT = 44
const NO_PAGES: LocalNotationPage[] = []
const pageIdOf = (page: LocalNotationPage) => page.id

/**
 * A tune's written music: a row of page thumbnails that open the viewer, and in edit mode a
 * list to reorder and delete them. Add takes image files from the device, each scaled and
 * re-encoded before it is stored.
 */
export function NotationSection({ tuneId }: { tuneId: string }) {
  const db = useDb()
  const data = useNotationPages(tuneId)
  const openMenu = useMenu()
  const picker = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const { error: deleteError, remove } = useDeletePage()
  const {
    ordered: pages,
    move,
    announcement,
  } = useReplayedOrder({
    items: data?.pages ?? NO_PAGES,
    idOf: pageIdOf,
    write: (pageId, targetId) => moveNotationPage(db, pageId, targetId),
    readOrder: async () =>
      sortPages(
        (await db.notation_pages.where('tune_id').equals(tuneId).toArray()).filter(
          (row) => !row.deleted_at,
        ),
      ).map(pageIdOf),
    announce: (rows, from, to) => `${pageName(from)} moved to ${to + 1} of ${rows.length}`,
    onMoveStart: () => setMoveError(null),
    onError: setMoveError,
  })
  // The rows a menu item acts on are the ones on screen when it is pressed, not when it opened.
  const pagesRef = useLatest(pages)

  if (data === undefined) return null

  const empty = pages.length === 0
  const full = pages.length >= MAX_NOTATION_PAGES

  const addFiles = async (files: File[]) => {
    setAdding(true)
    setAddError(null)
    const unreadable: string[] = []
    let room = MAX_NOTATION_PAGES - pagesRef.current.length
    let skipped = 0
    let failure: string | null = null
    try {
      // One at a time and in the order picked, so each page shows as soon as it is ready and a
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
        await addNotationPages(db, tuneId, [prepared])
        room--
      }
    } catch (caught) {
      failure = messageFor(caught)
    } finally {
      const said = [
        unreadable.length > 0 ? unreadableFilesMessage(unreadable) : null,
        skipped > 0 ? pagesNotAddedMessage(skipped) : null,
        failure,
      ].filter((line) => line !== null)
      setAddError(said.length > 0 ? said.join(' ') : null)
      setAdding(false)
    }
  }

  const moveMenu = (event: MouseEvent, page: LocalNotationPage, at: number) => {
    const items = moveMenuItems(at, pages.length, (place) => () => {
      const rows = pagesRef.current
      const now = rows.findIndex((row) => row.id === page.id)
      if (now >= 0) move(rows, now, place(now, rows.length - 1))
    })
    if (items.length > 0) openMenu(event, `Move ${pageName(at).toLowerCase()}`, items)
  }

  const actions = (
    <>
      {empty ? null : (
        <IonButton
          fill="clear"
          className="section-action"
          aria-label={editing ? DONE_EDITING_NOTATION : EDIT_NOTATION}
          onClick={() => setEditing(!editing)}
        >
          {editing ? DONE : EDIT}
        </IonButton>
      )}
      <IonButton
        fill="clear"
        className="section-action"
        aria-label={ADD_NOTATION}
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
        header={NOTATION}
        name={NOTATION}
        actions={actions}
        plain={empty || !editing}
        error={addError ?? deleteError ?? moveError}
        footer={full ? NOTATION_LIMIT_NOTE : undefined}
      >
        {empty ? (
          <EmptyState compact icon={FileMusic} title={NO_NOTATION_TITLE} hint={NO_NOTATION_HINT} />
        ) : editing ? (
          <IonReorderGroup
            disabled={pages.length < 2}
            onIonReorderEnd={(event: ReorderEndCustomEvent) => {
              const { from, to } = event.detail
              // React's own order stands, so Ionic must leave the DOM alone.
              event.detail.complete(false)
              move(pages, from, to)
            }}
          >
            {pages.map((page, at) => {
              const file = data.files.get(page.id)
              return (
                <IonItem key={page.id} data-page-id={page.id}>
                  <div slot="start" className="py-1">
                    <PageImage page={page} file={file} index={at} height={ROW_THUMBNAIL_HEIGHT} />
                  </div>
                  <IonLabel>
                    <h3>{pageName(at)}</h3>
                    <StatusLine page={page} file={file} />
                  </IonLabel>
                  <div slot="end" className="flex items-center">
                    <IonButton
                      fill="clear"
                      color="danger"
                      className="section-action"
                      aria-label={deletePageName(at)}
                      onClick={() => remove(page, file)}
                    >
                      <Trash2 aria-hidden="true" className="size-5" />
                    </IonButton>
                    {pages.length > 1 ? (
                      <>
                        {/* The grip swallows every click, so the same moves sit behind a
                            button a keyboard and a screen reader can reach. */}
                        <button
                          type="button"
                          aria-label={reorderPageName(at)}
                          className="grid size-11 place-items-center"
                          onClick={(event) => moveMenu(event, page, at)}
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
            aria-label={NOTATION}
            className="m-0 flex list-none gap-3 overflow-x-auto px-(--form-inset) py-1"
          >
            {pages.map((page, at) => (
              <PageTile
                key={page.id}
                page={page}
                file={data.files.get(page.id)}
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
        aria-label={CHOOSE_NOTATION_FILES}
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
        <NotationViewer tuneId={tuneId} startIndex={viewing} onClose={() => setViewing(null)} />
      ) : null}
    </>
  )
}

/** What a page cannot show by its image alone: why it has not uploaded, or that it is still to
 * come. */
function statusLabel(page: LocalNotationPage, file: NotationFile | undefined): string | null {
  if (file) return pageErrorLabel(file)
  return page.state === 'pending_upload' ? NOTATION_WAITING : null
}

function StatusLine({ page, file }: { page: LocalNotationPage; file: NotationFile | undefined }) {
  const label = statusLabel(page, file)
  return label ? <p className="type-footnote">{label}</p> : null
}

function PageTile({
  page,
  file,
  index,
  onOpen,
}: {
  page: LocalNotationPage
  file: NotationFile | undefined
  index: number
  onOpen: () => void
}) {
  const label = statusLabel(page, file)
  const labelId = useId()
  const brokenId = useId()
  const width = THUMBNAIL_HEIGHT * aspectRatio(page)
  return (
    <li
      data-page-id={page.id}
      className="flex shrink-0 flex-col gap-1"
      // A note under a narrow page widens its column rather than standing one word to a line.
      style={{ width: label ? Math.max(width, 128) : width }}
    >
      <button
        type="button"
        aria-label={openPageName(index)}
        // The name stands in for the button's contents, so a broken page's note is pointed at;
        // an id with no element behind it is ignored.
        aria-describedby={label ? `${brokenId} ${labelId}` : brokenId}
        className="w-fit overflow-hidden rounded-md"
        onClick={onOpen}
      >
        <PageImage
          page={page}
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

/** A page at a fixed height: its thumbnail, a broken-page mark, or a placeholder of its size. */
function PageImage({
  page,
  file,
  index,
  height,
  brokenId,
}: {
  page: LocalNotationPage
  file: NotationFile | undefined
  index: number
  height: number
  /** The id the broken-page note takes, for a control that names itself. */
  brokenId?: string
}) {
  const thumbnail = useThumbnail(file, page.height)
  const size = { height, width: height * aspectRatio(page) }
  const surface = 'grid place-items-center bg-(--ion-background-color-step-100)'
  if (!file) {
    return (
      <div data-page-placeholder className={surface} style={size}>
        {page.state === 'ready' ? (
          <div role="status" aria-label={downloadingPageName(index)}>
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
          {PAGE_UNREADABLE}
        </span>
      </div>
    )
  }
  if (thumbnail.kind === 'loading') return <div className={surface} style={size} />
  return <img src={thumbnail.url} alt="" className="block object-contain" style={size} />
}
