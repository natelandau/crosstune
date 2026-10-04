import { useIonRouter } from '@ionic/react'
import { AudioLines } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useDb } from '../../db/DbProvider'
import { SyncRefresher } from '../../sync/SyncRefresher'
import { EmptyState } from '../../ui/EmptyState'
import { Group } from '../../ui/Group'
import { InlineError } from '../../ui/InlineError'
import { Screen } from '../../ui/Screen'
import { messageFor } from '../../ui/useAction'
import { useRowArrowKeys } from '../../ui/useShortcut'
import { addAudioFiles } from './addAudioFiles'
import { AddToTuneSheet } from './AddToTuneSheet'
import { RecordingItem } from './RecordingItem'
import { RECORDING_ORIGINS } from '../../api/vocabulary'
import { RecordingsOriginFilter } from './RecordingsOriginFilter'
import { retryKind } from './recordingRow'
import { RenameRecordingSheet } from './RenameRecordingSheet'
import { Storage } from './Storage'
import { UploadButton } from './UploadButton'
import { useRecordingActions } from './useRecordingActions'
import { useRecordingsOrigin } from './useRecordingsOrigin'
import { useRecordingsWithFiles, type RecordingView } from './useRecordings'

export const NO_RECORDINGS_TITLE = 'No recordings yet'
export const NO_MATCHING_RECORDINGS_TITLE = 'No recordings from this source'
export const NO_RECORDINGS_HINT = 'Use the record button to make one, or upload an audio file.'

interface RecordingGroup {
  tuneId: string | null
  title: string
  views: RecordingView[]
}

/** Unfiled recordings first, then one group per tune in order of its newest recording. */
function groupByTune(views: readonly RecordingView[]): RecordingGroup[] {
  const groups = new Map<string | null, RecordingGroup>()
  for (const view of views) {
    const group = groups.get(view.tuneId)
    if (group) group.views.push(view)
    else {
      groups.set(view.tuneId, {
        tuneId: view.tuneId,
        title: view.tuneTitle ?? 'Unfiled',
        views: [view],
      })
    }
  }
  return [...groups.values()]
}

/** Vocabulary order; an origin the client predates sorts last. */
function sortOrigins(origins: readonly string[]): string[] {
  const rank = (origin: string) => {
    const at = (RECORDING_ORIGINS as readonly string[]).indexOf(origin)
    return at === -1 ? RECORDING_ORIGINS.length : at
  }
  return [...origins].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** Import sources the user holds. */
function heldOrigins(views: readonly RecordingView[]): string[] {
  const held = new Set(views.map((view) => view.recording.origin))
  held.delete('own')
  return sortOrigins([...held])
}

export function RecordingsPage() {
  const db = useDb()
  const loadedViews = useRecordingsWithFiles()
  const [choice, choose] = useRecordingsOrigin()
  // One Screen whether or not the data has loaded: swapping the IonPage element after the
  // router outlet has mounted it would leave the outlet holding a detached page.
  const ready = loadedViews !== undefined && choice !== undefined
  const router = useIonRouter()
  const [filing, setFiling] = useState<RecordingView | null>(null)
  const [renaming, setRenaming] = useState<RecordingView | null>(null)
  const { error, setUploadError, retry, actionsFor } = useRecordingActions({
    onRename: setRenaming,
    onAddToTune: setFiling,
  })
  const groupsRef = useRef<HTMLDivElement>(null)
  useRowArrowKeys(groupsRef)

  const imported = useMemo(() => (loadedViews ? heldOrigins(loadedViews) : []), [loadedViews])
  const groups = useMemo(() => {
    if (!loadedViews) return []
    const shown =
      choice === undefined || choice === 'all'
        ? loadedViews
        : loadedViews.filter((view) => view.recording.origin === choice)
    return groupByTune(shown)
  }, [loadedViews, choice])

  // A chosen source nothing is left from keeps its chip, so the list never narrows in silence.
  const stale =
    choice !== undefined &&
    choice !== 'all' &&
    !(loadedViews ?? []).some((view) => view.recording.origin === choice)
  const origins = stale && choice !== 'own' ? sortOrigins([...imported, choice]) : imported
  const hasOwn = (loadedViews ?? []).some((view) => view.recording.origin === 'own')
  const showRail = stale || imported.length > 1 || (imported.length === 1 && hasOwn)

  const addDropped = (files: File[]) => {
    setUploadError(null)
    addAudioFiles(db, files, null).catch((caught: unknown) => setUploadError(messageFor(caught)))
  }

  return (
    <Screen
      title="Recordings"
      level="top"
      grouped
      end={<UploadButton tuneId={null} onError={setUploadError} />}
      refresher={<SyncRefresher />}
      onDropFiles={addDropped}
    >
      <h1 className="sr-only">Recordings</h1>
      <Storage />
      {ready ? (
        <>
          {showRail ? (
            <RecordingsOriginFilter choice={choice} origins={origins} onChange={choose} />
          ) : null}
          {groups.length === 0 ? (
            loadedViews.length === 0 ? (
              <EmptyState icon={AudioLines} title={NO_RECORDINGS_TITLE} hint={NO_RECORDINGS_HINT} />
            ) : (
              <EmptyState icon={AudioLines} title={NO_MATCHING_RECORDINGS_TITLE} />
            )
          ) : null}
          {/* One container across every group, so the arrow keys walk the whole screen rather
              than stopping at the last row of a group. */}
          <div ref={groupsRef}>
            {groups.map((group) => {
              const tuneId = group.tuneId
              return (
                <Group
                  key={tuneId ?? ''}
                  header={group.title}
                  headerNames
                  onHeaderOpen={
                    tuneId
                      ? () => router.push(`/recordings/${tuneId}`, 'forward', 'push')
                      : undefined
                  }
                  headerOpenName={tuneId ? 'Open' : undefined}
                  name={group.title}
                >
                  {group.views.map((view) => (
                    <RecordingItem
                      key={view.recording.id}
                      view={view}
                      actions={actionsFor(view)}
                      error={retryKind(view) === 'upload' ? view.file?.error : null}
                      tuneNamedAbove={tuneId !== null}
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
      <AddToTuneSheet view={filing} onClose={() => setFiling(null)} />
    </Screen>
  )
}
