import { IonButton, IonItem, IonLabel, useIonRouter } from '@ionic/react'
import { Ellipsis, ListX, Music, Plus } from 'lucide-react'
import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { useParams } from 'react-router-dom'
import { removeFromList } from '../../commands/lists'
import { deleteTune, setArchived } from '../../commands/tunes'
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
import { StatusDot } from '../catalog/TuneItem'
import { ADD_TO_LIST, ListPicker } from '../lists/ListPicker'
import { useLists, useMembership } from '../lists/useLists'
import { lyricOpening } from '../lyrics/lyricLines'
import { LyricsModal } from '../lyrics/LyricsModal'
import { useRecordingsWithFiles, type RecordingView } from '../recordings/useRecordings'
import { tuningDisplay, tuningInstruments, tuningKey } from '../settings/instruments'
import { useInstruments } from '../settings/useInstruments'
import { ARCHIVE, UNARCHIVE } from './archiveLabels'
import { DELETE_TUNE_TITLE, deleteTuneMessage } from './deleteTuneMessage'
import { COMPOSER_LABEL } from './detailFields'
import { TuneFormSheet, type TuneFormTarget } from './TuneFormSheet'
import { TuneMedia } from './TuneMedia'
import { useTune } from './useTune'

export const ADD_TO_LIST_TITLE = 'Add to a list'
export const NOT_IN_LIST = 'Not in any list yet.'
export const OPEN_LYRICS = 'Open lyrics'
export const TUNE_GONE = 'This tune is gone'

type Params = Readonly<Record<string, string | undefined>>

/** One tune, in whichever stack opened it: the catalog, a list, or recordings. */
export function TuneScreen({ parent }: { parent: (params: Params) => string }) {
  const params = useParams()
  const tuneId = params.tuneId ?? ''
  const backHref = parent(params)
  const view = useTune(tuneId)
  const instruments = useInstruments()
  const recordings = useRecordingsWithFiles({ tuneId })
  const db = useDb()
  const router = useIonRouter()
  const openMenu = useMenu()
  const confirm = useConfirm()
  const { error, run, runThen } = useAction()
  const lists = useLists()
  const membership = useMembership(view?.userTune.id ?? '')
  const userTuneId = view?.userTune.id
  const pickerTuneIds = useMemo(() => (userTuneId ? [userTuneId] : []), [userTuneId])
  // The sheet resets its values whenever the target's identity changes, so the target holds the
  // rows as they were when Edit was pressed rather than following every live update.
  const [editTarget, setEditTarget] = useState<TuneFormTarget | null>(null)
  const [picking, setPicking] = useState(false)
  const [reading, setReading] = useState(false)
  // The title of a tune whose confirmed delete is running, so the live query reporting the tune
  // gone does not flash "This tune is gone" while the screen navigates away.
  const [deletingTitle, setDeletingTitle] = useState<string | null>(null)
  const deleted = deletingTitle !== null
  // Refs rather than state: two presses in one tick both read the same committed state.
  const deleting = useRef(false)
  const removing = useRef(new Set<string>())
  const ready = view !== undefined && instruments !== undefined && recordings !== undefined
  // One Screen in every state: swapping the IonPage element after the router outlet has
  // mounted it would leave the outlet holding a detached page.
  const tune = ready && !deleted ? view : null

  const confirmDelete = async (entry: CatalogEntry) => {
    if (deleting.current) return
    deleting.current = true
    const ok = await confirm({
      title: DELETE_TUNE_TITLE,
      message: deleteTuneMessage(entry.tune.title, recordings ?? []),
      action: DELETE,
    })
    if (!ok) {
      deleting.current = false
      return
    }
    setDeletingTitle(entry.tune.title)
    runThen(
      async () => {
        try {
          await deleteTune(db, entry.tune.id)
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
    const archived = entry.userTune.archived_at !== null
    openMenu(event, MORE_ACTIONS, [
      { label: ADD_TO_LIST, onPress: () => setPicking(true) },
      {
        label: archived ? UNARCHIVE : ARCHIVE,
        tone: 'warning',
        onPress: () => run(() => setArchived(db, entry.userTune.id, !archived)),
      },
      { label: 'Delete', tone: 'error', onPress: () => void confirmDelete(entry) },
    ])
  }

  const notFound = ready && view === null && !deleted

  return (
    <Screen
      title={tune ? tune.tune.title : (deletingTitle ?? (notFound ? 'Tune' : ''))}
      level="pushed"
      backHref={backHref}
      grouped
      end={
        tune ? (
          <>
            <IonButton
              onClick={() =>
                setEditTarget({
                  kind: 'edit',
                  entry: { tune: tune.tune, userTune: tune.userTune },
                })
              }
            >
              Edit
            </IonButton>
            <IonButton aria-label={MORE_ACTIONS} onClick={(event) => openActions(event, tune)}>
              <Ellipsis aria-hidden="true" className="size-6" />
            </IonButton>
          </>
        ) : null
      }
    >
      {notFound ? (
        <>
          <h1 className="sr-only">Tune</h1>
          <EmptyState icon={Music} title={TUNE_GONE} />
        </>
      ) : null}
      {!ready && !deleted ? <h1 className="sr-only">Tune</h1> : null}
      {deletingTitle !== null ? (
        <header className="space-y-1 px-(--form-inset) pt-4">
          <h1 className="type-title m-0">{deletingTitle}</h1>
          <p role="status" className="type-footnote m-0">
            {DELETING}
          </p>
          {error ? <InlineError className="pt-2">{error}</InlineError> : null}
        </header>
      ) : null}
      {tune && instruments && recordings ? (
        <TuneBody
          entry={tune}
          badges={badgesFor(tune, instruments)}
          error={error}
          recordings={recordings}
          links={tune.links}
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
          <TuneFormSheet
            target={editTarget}
            instruments={instruments}
            onClose={() => setEditTarget(null)}
            onSaved={() => setEditTarget(null)}
          />
          <ListPicker
            open={picking && !deleted}
            userTuneIds={pickerTuneIds}
            title={ADD_TO_LIST_TITLE}
            onClose={() => setPicking(false)}
          />
          <LyricsModal
            open={reading && !deleted}
            tuneId={view.tune.id}
            title={view.tune.title}
            lyrics={view.tune.lyrics ?? ''}
            onClose={() => setReading(false)}
          />
        </>
      ) : null}
    </Screen>
  )
}

function badgesFor(
  { tune }: CatalogEntry,
  instruments: NonNullable<ReturnType<typeof useInstruments>>,
): { field: string; label: string }[] {
  return [
    // Two instruments can share a tuning's name, so each badge names its instrument.
    ...tuningInstruments(instruments, tune).map((instrument) => ({
      field: tuningKey(instrument),
      label: tuningDisplay(instrument, tune.tunings, { withInstrument: true }),
    })),
    { field: 'time_signature', label: tune.time_signature },
    { field: 'is_crooked', label: tune.is_crooked ? 'Crooked' : null },
    { field: 'tune_type', label: tune.tune_type },
    { field: 'genre', label: tune.genre },
    { field: 'part_structure', label: tune.part_structure },
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

function TuneBody({
  entry: { tune, userTune },
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
  const archived = userTune.archived_at !== null
  const learned = userTune.learned_from !== null || userTune.learned_on !== null
  // A body runs to 20,000 characters, and this screen re-renders on every change to the tune.
  const hasLyrics = useMemo(() => lyricOpening(tune.lyrics, 1).length > 0, [tune.lyrics])

  return (
    <>
      <header className="space-y-1 px-(--form-inset) pt-4">
        <h1 className="type-title m-0">{tune.title}</h1>
        {/* Another name for the tune, so it sits with the title rather than among the facets. */}
        {tune.alternate_titles.length > 0 ? (
          <p className="type-footnote m-0">{tune.alternate_titles.join(', ')}</p>
        ) : null}
        {tune.composer ? (
          <p className="type-footnote m-0">
            {COMPOSER_LABEL}: {tune.composer}
          </p>
        ) : null}
        {/* Every facet the tune holds, in one wrapping row: what it is comes before anything
            the screen asks the musician to do about it. */}
        <div data-tune-facets className="flex flex-wrap items-center gap-1 pt-2">
          {tune.key ? <KeyPill value={tune.key} /> : null}
          {tune.modes.map((mode, index) => (
            <Capsule key={`mode-${index}`}>{mode}</Capsule>
          ))}
          <Capsule>
            <StatusDot status={userTune.status} />
          </Capsule>
          {badges.map((badge) => (
            <Capsule key={badge.field}>{badge.label}</Capsule>
          ))}
          {archived ? <Capsule tone="warning">Archived</Capsule> : null}
        </div>
        {error ? <InlineError className="pt-2">{error}</InlineError> : null}
      </header>

      <TuneMedia tuneId={tune.id} recordings={recordings} links={links} />

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

      {userTune.notes || learned ? (
        <Group header="Notes">
          <IonItem lines="none">
            <IonLabel className="ion-text-wrap">
              {learned ? (
                <p className="type-footnote">
                  Learned
                  {userTune.learned_from ? ` from ${userTune.learned_from}` : null}
                  {userTune.learned_on ? (
                    <>
                      {' on '}
                      <span className="tabular-nums">{formatLearnedOn(userTune.learned_on)}</span>
                    </>
                  ) : null}
                </p>
              ) : null}
              {userTune.notes ? (
                <p className="type-body whitespace-pre-wrap">{userTune.notes}</p>
              ) : null}
            </IonLabel>
          </IonItem>
        </Group>
      ) : null}
    </>
  )
}
