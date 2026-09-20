import {
  IonRefresher,
  IonRefresherContent,
  useIonRouter,
  type RefresherCustomEvent,
} from '@ionic/react'
import { AudioLines } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { usePointer } from '../../platform/pointer'
import { useSyncEngine } from '../../sync/SyncProvider'
import { EmptyState } from '../../ui/EmptyState'
import { Group } from '../../ui/Group'
import { InlineError } from '../../ui/InlineError'
import { Screen } from '../../ui/Screen'
import { useRowArrowKeys } from '../../ui/useShortcut'
import { AddToSongSheet } from './AddToSongSheet'
import { RecordingItem } from './RecordingItem'
import { retryKind } from './recordingRow'
import { RenameRecordingSheet } from './RenameRecordingSheet'
import { Storage } from './Storage'
import { UploadButton } from './UploadButton'
import { useRecordingActions } from './useRecordingActions'
import { useRecordingsWithFiles, type RecordingView } from './useRecordings'

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
  // One Screen whether or not the data has loaded: swapping the IonPage element after the
  // router outlet has mounted it would leave the outlet holding a detached page.
  const ready = loadedViews !== undefined
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
              const songId = group.songId
              return (
                <Group
                  key={songId ?? ''}
                  header={group.title}
                  headerNames
                  onHeaderOpen={
                    songId
                      ? () => router.push(`/recordings/${songId}`, 'forward', 'push')
                      : undefined
                  }
                  headerOpenName={songId ? 'Open' : undefined}
                  name={group.title}
                >
                  {group.views.map((view) => (
                    <RecordingItem
                      key={view.recording.id}
                      view={view}
                      actions={actionsFor(view)}
                      error={retryKind(view) === 'upload' ? view.file?.error : null}
                      songNamedAbove={songId !== null}
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
