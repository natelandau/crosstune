import { IonButton, IonItem, IonLabel, useIonRouter } from '@ionic/react'
import { Ellipsis, ListX, Music, Plus } from 'lucide-react'
import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { useParams } from 'react-router-dom'
import { removeFromList } from '../../commands/lists'
import { deleteSong, setArchived } from '../../commands/songs'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { type LocalRecordingLink } from '../../db/types'
import { Capsule } from '../../ui/Capsule'
import { DELETE, DELETING, useConfirm } from '../../ui/Confirm'
import { EmptyState } from '../../ui/EmptyState'
import { Group } from '../../ui/Group'
import { InlineError } from '../../ui/InlineError'
import { KeyPill } from '../../ui/KeyPill'
import { MORE_ACTIONS, useMenu } from '../../ui/Menu'
import { Row } from '../../ui/Row'
import { Screen } from '../../ui/Screen'
import type { CatalogEntry } from '../catalog/filters'
import { StatusDot } from '../catalog/SongItem'
import { ADD_TO_LIST, ListPicker } from '../lists/ListPicker'
import { useLists, useMembership } from '../lists/useLists'
import { lyricOpening } from '../lyrics/lyricLines'
import { LyricsModal } from '../lyrics/LyricsModal'
import { useRecordingsWithFiles, type RecordingView } from '../recordings/useRecordings'
import { visibleTunings } from '../settings/instruments'
import { useInstruments } from '../settings/useInstruments'
import { ARCHIVE, UNARCHIVE } from './archiveLabels'
import { DELETE_SONG_TITLE, deleteSongMessage } from './deleteSongMessage'
import { SongFormSheet, type SongFormTarget } from './SongFormSheet'
import { SongMedia } from './SongMedia'
import { useSong } from './useSong'

export const ADD_TO_LIST_TITLE = 'Add to a list'
export const NOT_IN_LIST = 'Not in any list yet.'
export const OPEN_LYRICS = 'Open lyrics'
export const SONG_GONE = 'This song is gone'

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
  const [reading, setReading] = useState(false)
  // The title of a song whose confirmed delete is running, so the live query reporting the song
  // gone does not flash "This song is gone" while the screen navigates away.
  const [deletingTitle, setDeletingTitle] = useState<string | null>(null)
  const deleted = deletingTitle !== null
  // Refs rather than state: two presses in one tick both read the same committed state.
  const deleting = useRef(false)
  const removing = useRef(new Set<string>())
  const ready = view !== undefined && instruments !== undefined && recordings !== undefined
  // One Screen in every state: swapping the IonPage element after the router outlet has
  // mounted it would leave the outlet holding a detached page.
  const song = ready && !deleted ? view : null

  const confirmDelete = async (entry: CatalogEntry) => {
    if (deleting.current) return
    deleting.current = true
    const ok = await confirm({
      title: DELETE_SONG_TITLE,
      message: deleteSongMessage(entry.song.title, recordings ?? []),
      action: DELETE,
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
    openMenu(event, MORE_ACTIONS, [
      { label: ADD_TO_LIST, onPress: () => setPicking(true) },
      {
        label: archived ? UNARCHIVE : ARCHIVE,
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
            <IonButton aria-label={MORE_ACTIONS} onClick={(event) => openActions(event, song)}>
              <Ellipsis aria-hidden="true" className="size-6" />
            </IonButton>
          </>
        ) : null
      }
    >
      {notFound ? (
        <>
          <h1 className="sr-only">Song</h1>
          <EmptyState icon={Music} title={SONG_GONE} />
        </>
      ) : null}
      {!ready && !deleted ? <h1 className="sr-only">Song</h1> : null}
      {deletingTitle !== null ? (
        <header className="space-y-1 px-(--form-inset) pt-4">
          <h1 className="type-title m-0">{deletingTitle}</h1>
          <p role="status" className="type-footnote m-0">
            {DELETING}
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
          onOpenList={(listId) => router.push(`/lists/${listId}`, 'forward', 'push')}
          onRemove={removeItem}
          onAddToList={() => setPicking(true)}
          onReadLyrics={() => setReading(true)}
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
            title={ADD_TO_LIST_TITLE}
            onClose={() => setPicking(false)}
          />
          <LyricsModal
            open={reading && !deleted}
            songId={view.song.id}
            title={view.song.title}
            lyrics={view.song.lyrics ?? ''}
            onClose={() => setReading(false)}
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
  error,
  recordings,
  links,
  inLists,
  onOpenList,
  onRemove,
  onAddToList,
  onReadLyrics,
}: {
  entry: CatalogEntry
  badges: { field: string; label: string }[]
  error: string | null
  recordings: readonly RecordingView[]
  links: readonly LocalRecordingLink[]
  inLists: { id: string; name: string; itemId: string }[]
  onOpenList: (listId: string) => void
  onRemove: (itemId: string) => void
  onAddToList: () => void
  onReadLyrics: () => void
}) {
  const archived = userSong.archived_at !== null
  const mode = song.mode ?? ''
  const learned = userSong.learned_from !== null || userSong.learned_on !== null
  // A body runs to 20,000 characters, and this screen re-renders on every change to the song.
  const hasLyrics = useMemo(() => lyricOpening(song.lyrics, 1).length > 0, [song.lyrics])

  return (
    <>
      <header className="space-y-1 px-(--form-inset) pt-4">
        <h1 className="type-title m-0">{song.title}</h1>
        {/* Another name for the song, so it sits with the title rather than among the facets. */}
        {song.alternate_titles.length > 0 ? (
          <p className="type-footnote m-0">{song.alternate_titles.join(', ')}</p>
        ) : null}
        {/* Every facet the song holds, in one wrapping row: what it is comes before anything
            the screen asks the musician to do about it. */}
        <div data-song-facets className="flex flex-wrap items-center gap-1 pt-2">
          {song.key ? <KeyPill value={song.key} /> : null}
          {mode ? <Capsule>{mode}</Capsule> : null}
          <Capsule>
            <StatusDot status={userSong.status} />
          </Capsule>
          {badges.map((badge) => (
            <Capsule key={badge.field}>{badge.label}</Capsule>
          ))}
          {archived ? <Capsule tone="warning">Archived</Capsule> : null}
        </div>
        {error ? <InlineError className="pt-2">{error}</InlineError> : null}
      </header>

      <SongMedia songId={song.id} recordings={recordings} links={links} />

      {/* Words, not a body: whitespace alone would open the reading view on a blank page. */}
      {hasLyrics ? (
        <div className="px-(--form-gutter) pt-(--form-section-gap)">
          <IonButton expand="block" className="min-h-11" onClick={onReadLyrics}>
            {OPEN_LYRICS}
          </IonButton>
        </div>
      ) : null}

      <Group
        header="Lists"
        name="Lists"
        actions={
          <IonButton
            fill="clear"
            className="section-action"
            aria-label={ADD_TO_LIST}
            onClick={onAddToList}
          >
            <Plus aria-hidden="true" className="size-5" />
          </IonButton>
        }
        plain={inLists.length === 0}
        footer={inLists.length === 0 ? NOT_IN_LIST : undefined}
      >
        {inLists.map((list) => (
          <Row
            key={list.id}
            name={list.name}
            onOpen={() => onOpenList(list.id)}
            actions={[
              {
                label: 'Remove',
                icon: ListX,
                tone: 'error',
                onPress: () => onRemove(list.itemId),
              },
            ]}
          >
            <IonLabel className="truncate">{list.name}</IonLabel>
          </Row>
        ))}
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
