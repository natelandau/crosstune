import {
  IonButton,
  IonItem,
  IonLabel,
  IonSegment,
  IonSegmentButton,
  useIonRouter,
} from '@ionic/react'
import { Ellipsis, Minus, Music } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useParams } from 'react-router-dom'
import { removeFromList } from '../../commands/lists'
import { deleteSong, setArchived, updateUserSong } from '../../commands/songs'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { STATUSES, type LocalRecordingLink, type SongStatus } from '../../db/types'
import { Capsule } from '../../ui/Capsule'
import { useConfirm } from '../../ui/Confirm'
import { EmptyState } from '../../ui/EmptyState'
import { Group } from '../../ui/Group'
import { InlineError } from '../../ui/InlineError'
import { useMenu } from '../../ui/Menu'
import { Row } from '../../ui/Row'
import { Screen } from '../../ui/Screen'
import { usePendingWrite } from '../../ui/usePendingWrite'
import type { CatalogEntry } from '../catalog/filters'
import { STATUS_LABELS } from '../catalog/status'
import { ListPicker } from '../lists/ListPicker'
import { useLists, useMembership } from '../lists/useLists'
import { useRecordingsWithFiles, type RecordingView } from '../recordings/useRecordings'
import { visibleTunings } from '../settings/instruments'
import { useInstruments } from '../settings/useInstruments'
import { deleteSongMessage } from './deleteSongMessage'
import { SongFormSheet, type SongFormTarget } from './SongFormSheet'
import { SongMedia } from './SongMedia'
import { useSong } from './useSong'

type Params = Readonly<Record<string, string | undefined>>

/** One song, in whichever stack opened it: the catalog, a list, or recordings. */
export function SongScreen({ parent }: { parent: (params: Params) => string }) {
  const params = useParams()
  const songId = params.songId ?? ''
  const backHref = parent(params)
  const view = useSong(songId)
  const instruments = useInstruments()
  const recordings = useRecordingsWithFiles({ songId })
  const db = useDb()
  const router = useIonRouter()
  const openMenu = useMenu()
  const confirm = useConfirm()
  const { error, run, runThen } = useAction()
  const lists = useLists()
  const membership = useMembership(view?.userSong.id ?? '')
  const userSongId = view?.userSong.id
  const pickerSongIds = useMemo(() => (userSongId ? [userSongId] : []), [userSongId])
  // The sheet resets its values whenever the target's identity changes, so the target holds the
  // rows as they were when Edit was pressed rather than following every live update.
  const [editTarget, setEditTarget] = useState<SongFormTarget | null>(null)
  const [picking, setPicking] = useState(false)
  // The title of a song whose confirmed delete is running, so the live query reporting the song
  // gone does not flash "This song is gone" while the screen navigates away.
  const [deletingTitle, setDeletingTitle] = useState<string | null>(null)
  const deleted = deletingTitle !== null
  // Refs rather than state: two presses in one tick both read the same committed state.
  const deleting = useRef(false)
  const removing = useRef(new Set<string>())
  const updateStatus = useCallback(
    (patch: { status: SongStatus }) =>
      view ? updateUserSong(db, view.userSong.id, patch) : Promise.resolve(),
    [db, view],
  )
  // The segment shows the chosen status until the row is read again after its write.
  const [shownUserSong, writeStatus] = usePendingWrite(view?.userSong, updateStatus)

  const ready = view !== undefined && instruments !== undefined && recordings !== undefined
  // One Screen in every state: swapping the IonPage element after the router outlet has
  // mounted it would leave the outlet holding a detached page.
  const song = ready && !deleted ? view : null

  const confirmDelete = async (entry: CatalogEntry) => {
    if (deleting.current) return
    deleting.current = true
    const ok = await confirm({
      title: 'Delete song?',
      message: deleteSongMessage(entry.song.title, recordings ?? []),
      action: 'Delete',
    })
    if (!ok) {
      deleting.current = false
      return
    }
    setDeletingTitle(entry.song.title)
    runThen(
      async () => {
        try {
          await deleteSong(db, entry.song.id)
        } catch (caught) {
          deleting.current = false
          setDeletingTitle(null)
          throw caught
        }
      },
      () => (router.canGoBack() ? router.goBack() : router.push(backHref, 'back', 'replace')),
    )
  }

  const changeStatus = (status: SongStatus) => {
    // Started before run() touches any state, so the render that follows already carries the
    // new value onto the segment.
    const write = writeStatus({ status })
    run(() => write)
  }

  const removeItem = (itemId: string) => {
    if (removing.current.has(itemId)) return
    removing.current.add(itemId)
    run(async () => {
      try {
        await removeFromList(db, itemId)
      } finally {
        removing.current.delete(itemId)
      }
    })
  }

  const openActions = (event: MouseEvent, entry: CatalogEntry) => {
    const archived = entry.userSong.archived_at !== null
    openMenu(event, 'More actions', [
      { label: 'Add to list', onPress: () => setPicking(true) },
      {
        label: archived ? 'Unarchive' : 'Archive',
        tone: 'warning',
        onPress: () => run(() => setArchived(db, entry.userSong.id, !archived)),
      },
      { label: 'Delete', tone: 'error', onPress: () => void confirmDelete(entry) },
    ])
  }

  const notFound = ready && view === null && !deleted

  return (
    <Screen
      title={song ? song.song.title : (deletingTitle ?? (notFound ? 'Song' : ''))}
      level="pushed"
      backHref={backHref}
      grouped
      end={
        song ? (
          <>
            <IonButton
              onClick={() =>
                setEditTarget({
                  kind: 'edit',
                  entry: { song: song.song, userSong: song.userSong },
                })
              }
            >
              Edit
            </IonButton>
            <IonButton aria-label="More actions" onClick={(event) => openActions(event, song)}>
              <Ellipsis aria-hidden="true" className="size-6" />
            </IonButton>
          </>
        ) : null
      }
    >
      {notFound ? (
        <>
          <h1 className="sr-only">Song</h1>
          <EmptyState icon={Music} title="This song is gone" />
        </>
      ) : null}
      {!ready && !deleted ? <h1 className="sr-only">Song</h1> : null}
      {deletingTitle !== null ? (
        <header className="space-y-1 px-5 pt-4">
          <h1 className="type-title m-0">{deletingTitle}</h1>
          <p role="status" className="type-footnote m-0">
            Deleting…
          </p>
          {error ? <InlineError className="pt-2">{error}</InlineError> : null}
        </header>
      ) : null}
      {song && instruments && recordings ? (
        <SongBody
          entry={song}
          badges={badgesFor(song, instruments)}
          error={error}
          recordings={recordings}
          links={song.links}
          inLists={(lists ?? []).flatMap((list) => {
            const itemId = membership.get(list.id)
            return itemId ? [{ id: list.id, name: list.name, itemId }] : []
          })}
          status={shownUserSong?.status ?? song.userSong.status}
          onStatus={changeStatus}
          onOpenList={(listId) => router.push(`/lists/${listId}`, 'forward', 'push')}
          onRemove={removeItem}
          onAddToList={() => setPicking(true)}
        />
      ) : null}
      {view && instruments ? (
        <>
          <SongFormSheet
            target={editTarget}
            instruments={instruments}
            onClose={() => setEditTarget(null)}
            onSaved={() => setEditTarget(null)}
          />
          <ListPicker
            open={picking && !deleted}
            userSongIds={pickerSongIds}
            title="Add to a list"
            onClose={() => setPicking(false)}
          />
        </>
      ) : null}
    </Screen>
  )
}

function badgesFor(
  { song }: CatalogEntry,
  instruments: NonNullable<ReturnType<typeof useInstruments>>,
): { field: string; label: string }[] {
  return [
    ...visibleTunings(instruments, song).map((field) => ({ field, label: song[field] })),
    { field: 'time_signature', label: song.time_signature },
    { field: 'is_crooked', label: song.is_crooked ? 'Crooked' : null },
    { field: 'feel', label: song.feel },
    { field: 'genre', label: song.genre },
    { field: 'part_structure', label: song.part_structure },
    { field: 'has_lyrics', label: song.has_lyrics ? 'Lyrics' : null },
  ].filter((badge): badge is { field: string; label: string } => Boolean(badge.label))
}

const LEARNED_ON_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/** A stored YYYY-MM-DD read as a local calendar date, so no timezone moves it a day. */
function formatLearnedOn(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return LEARNED_ON_FORMAT.format(new Date(Number(year), Number(month) - 1, Number(day)))
}

function SongBody({
  entry: { song, userSong },
  badges,
  status,
  error,
  recordings,
  links,
  inLists,
  onStatus,
  onOpenList,
  onRemove,
  onAddToList,
}: {
  entry: CatalogEntry
  badges: { field: string; label: string }[]
  status: string
  error: string | null
  recordings: readonly RecordingView[]
  links: readonly LocalRecordingLink[]
  inLists: { id: string; name: string; itemId: string }[]
  onStatus: (status: SongStatus) => void
  onOpenList: (listId: string) => void
  onRemove: (itemId: string) => void
  onAddToList: () => void
}) {
  const archived = userSong.archived_at !== null
  const keyLine = [song.key, song.mode].filter(Boolean).join(' ')
  const learned = userSong.learned_from !== null || userSong.learned_on !== null

  return (
    <>
      <header className="space-y-1 px-5 pt-4">
        <h1 className="type-title m-0">{song.title}</h1>
        {keyLine ? <p className="type-headline m-0 tabular-nums">{keyLine}</p> : null}
        {song.alternate_titles.length > 0 ? (
          <p className="type-footnote m-0">{song.alternate_titles.join(', ')}</p>
        ) : null}
        {badges.length > 0 || archived ? (
          <div className="flex flex-wrap gap-1 pt-2">
            {badges.map((badge) => (
              <Capsule key={badge.field}>{badge.label}</Capsule>
            ))}
            {archived ? <Capsule tone="warning">Archived</Capsule> : null}
          </div>
        ) : null}
        {error ? <InlineError className="pt-2">{error}</InlineError> : null}
      </header>

      <Group header="Status">
        <IonItem lines="none">
          <IonSegment
            aria-label="Status"
            value={status}
            onIonChange={(event) => onStatus(event.detail.value as SongStatus)}
          >
            {STATUSES.map((status) => (
              <IonSegmentButton key={status} value={status}>
                <IonLabel>{STATUS_LABELS[status]}</IonLabel>
              </IonSegmentButton>
            ))}
          </IonSegment>
        </IonItem>
      </Group>

      <SongMedia songId={song.id} recordings={recordings} links={links} />

      <Group header="Lists" footer={inLists.length === 0 ? 'Not in any list yet.' : undefined}>
        {inLists.map((list) => (
          <Row
            key={list.id}
            name={list.name}
            onOpen={() => onOpenList(list.id)}
            actions={[
              {
                label: 'Remove',
                icon: Minus,
                tone: 'error',
                onPress: () => onRemove(list.itemId),
              },
            ]}
          >
            <IonLabel className="truncate">{list.name}</IonLabel>
          </Row>
        ))}
        <IonItem button detail={false} onClick={onAddToList}>
          <IonLabel color="primary">Add to list</IonLabel>
        </IonItem>
      </Group>

      {userSong.notes || learned ? (
        <Group header="Notes">
          <IonItem lines="none">
            <IonLabel className="ion-text-wrap">
              {learned ? (
                <p className="type-footnote">
                  Learned
                  {userSong.learned_from ? ` from ${userSong.learned_from}` : null}
                  {userSong.learned_on ? (
                    <>
                      {' on '}
                      <span className="tabular-nums">{formatLearnedOn(userSong.learned_on)}</span>
                    </>
                  ) : null}
                </p>
              ) : null}
              {userSong.notes ? (
                <p className="type-body whitespace-pre-wrap">{userSong.notes}</p>
              ) : null}
            </IonLabel>
          </IonItem>
        </Group>
      ) : null}
    </>
  )
}
