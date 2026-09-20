import {
  IonRefresher,
  IonRefresherContent,
  useIonRouter,
  type RefresherCustomEvent,
} from '@ionic/react'
import { AudioLines } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Instrument } from '../../db/types'
import { usePointer } from '../../platform/pointer'
import { useSyncEngine } from '../../sync/SyncProvider'
import { EmptyState } from '../../ui/EmptyState'
import { Group } from '../../ui/Group'
import { InlineError } from '../../ui/InlineError'
import { Screen } from '../../ui/Screen'
import { useRowArrowKeys } from '../../ui/useShortcut'
import type { CatalogEntry } from '../catalog/filters'
import { SongItem } from '../catalog/SongItem'
import { useCatalog } from '../catalog/useCatalog'
import { useInstruments } from '../settings/useInstruments'
import { AddToSongSheet } from './AddToSongSheet'
import { RecordingItem } from './RecordingItem'
import { retryKind } from './recordingRow'
import { RenameRecordingSheet } from './RenameRecordingSheet'
import { Storage } from './Storage'
import { UploadButton } from './UploadButton'
import { useRecordingActions } from './useRecordingActions'
import { useRecordingsWithFiles, type RecordingView } from './useRecordings'

const NO_ENTRIES: CatalogEntry[] = []
const NO_INSTRUMENTS: ReadonlySet<Instrument> = new Set()

interface RecordingGroup {
  songId: string | null
  title: string
  views: RecordingView[]
}

/** Unfiled recordings first, then one group per song in order of its newest recording. */
function groupBySong(views: readonly RecordingView[]): RecordingGroup[] {
  const groups = new Map<string | null, RecordingGroup>()
  for (const view of views) {
    const group = groups.get(view.songId)
    if (group) group.views.push(view)
    else {
      groups.set(view.songId, {
        songId: view.songId,
        title: view.songTitle ?? 'Unfiled',
        views: [view],
      })
    }
  }
  return [...groups.values()]
}

export function RecordingsPage() {
  const loadedViews = useRecordingsWithFiles()
  const loadedEntries = useCatalog()
  const loadedInstruments = useInstruments()
  // One Screen whether or not the data has loaded: swapping the IonPage element after the
  // router outlet has mounted it would leave the outlet holding a detached page.
  const ready =
    loadedViews !== undefined && loadedEntries !== undefined && loadedInstruments !== undefined
  const entries = loadedEntries ?? NO_ENTRIES
  const instruments = loadedInstruments ?? NO_INSTRUMENTS
  const engine = useSyncEngine()
  const router = useIonRouter()
  const pointer = usePointer()
  const [renaming, setRenaming] = useState<RecordingView | null>(null)
  const [filing, setFiling] = useState<RecordingView | null>(null)
  const { error, setUploadError, retry, actionsFor } = useRecordingActions({
    onRename: setRenaming,
    onAddToSong: setFiling,
  })
  const groupsRef = useRef<HTMLDivElement>(null)
  useRowArrowKeys(groupsRef)

  const groups = useMemo(() => (loadedViews ? groupBySong(loadedViews) : []), [loadedViews])
  const entryFor = useMemo(() => new Map(entries.map((entry) => [entry.song.id, entry])), [entries])

  const refresh = (event: RefresherCustomEvent) => {
    void engine.sync().finally(() => event.detail.complete())
  }

  return (
    <Screen
      title="Recordings"
      level="top"
      grouped
      end={<UploadButton songId={null} onError={setUploadError} />}
      refresher={
        pointer === 'touch' ? (
          <IonRefresher slot="fixed" onIonRefresh={refresh}>
            <IonRefresherContent />
          </IonRefresher>
        ) : null
      }
    >
      <h1 className="sr-only">Recordings</h1>
      <Storage />
      {ready ? (
        <>
          {groups.length === 0 ? (
            <EmptyState
              icon={AudioLines}
              title="No recordings yet"
              hint="Use the record button to make one, or upload an audio file."
            />
          ) : null}
          {/* One container across every group, so the arrow keys walk the whole screen rather
              than stopping at the last row of a group. */}
          <div ref={groupsRef}>
            {groups.map((group) => {
              const entry = group.songId ? entryFor.get(group.songId) : undefined
              return (
                <Group
                  key={group.songId ?? ''}
                  // A song heads its group with its own row, which carries the key and the
                  // tunings no header line of this screen's own would.
                  header={entry ? undefined : group.title}
                  name={group.title}
                >
                  {entry ? (
                    <SongItem
                      entry={entry}
                      instruments={instruments}
                      onOpen={() => router.push(`/recordings/${entry.song.id}`, 'forward', 'push')}
                    />
                  ) : null}
                  {group.views.map((view) => (
                    <RecordingItem
                      key={view.recording.id}
                      view={view}
                      actions={actionsFor(view)}
                      error={retryKind(view) === 'upload' ? view.file?.error : null}
                      // Every group but Unfiled is headed by its song, whether as the song's
                      // own row or as a plain header line.
                      songNamedAbove={group.songId !== null}
                      onRetry={(kind) => retry(view, kind)}
                    />
                  ))}
                </Group>
              )
            })}
          </div>
          {error ? <InlineError className="px-(--form-inset) py-2">{error}</InlineError> : null}
        </>
      ) : null}
      <RenameRecordingSheet view={renaming} onClose={() => setRenaming(null)} />
      <AddToSongSheet view={filing} onClose={() => setFiling(null)} />
    </Screen>
  )
}
