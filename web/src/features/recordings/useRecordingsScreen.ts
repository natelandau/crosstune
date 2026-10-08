import { useMemo, useState } from 'react'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import type { MenuItem } from '../../ui/menuTypes'
import type { RowAction } from '../../ui/rowTypes'
import { readSearchQuery, writeSearchQuery } from '../catalog/searchSession'
import {
  arrangedCount,
  arrangeRecordings,
  recordingCountLabel,
  type FiledArrangement,
  type SortChoice,
} from './arrangeRecordings'
import { setRecordingsSort, useRecordingsSort } from './recordingsSort'
import { useAudioImport } from './useAudioImport'
import { useRecordingActionsWith } from './useRecordingActionsWith'
import { useRecordingsOrigin, type OriginChoice } from './useRecordingsOrigin'
import { useRecordingsWithFiles, type RecordingView } from './useRecordings'

const NO_VIEWS: RecordingView[] = []

export interface RecordingsScreenOptions {
  confirm: (question: ConfirmQuestion) => Promise<boolean>
  onOpenTune: (tuneId: string) => void
}

export interface RecordingsScreen {
  /** False until the recordings and the chosen source have both been read. */
  ready: boolean
  /** Every stored recording, whatever the source and search. */
  total: number
  /** How many recordings the source and search leave showing. */
  listed: number
  /** "24 recordings", or "3 of 24 recordings" when narrowed. */
  countLabel: string
  unfiled: RecordingView[]
  filed: FiledArrangement
  sort: SortChoice
  setSort: (choice: SortChoice) => void
  query: string
  /** Sets the query and keeps it for the rest of the session. */
  setQuery: (value: string) => void
  /** The source the list shows, 'all' while loading. */
  source: OriginChoice
  setSource: (next: OriginChoice) => void
  /** Import sources the musician holds a recording from. */
  origins: string[]
  /** Whether a source other than All is set. */
  filterSet: boolean
  /**
   * Whether the Filters control shows: once loaded, and only while an import gives the sources
   * something to tell apart or a source is set, so a set source keeps its way back to All.
   */
  showsFilters: boolean
  /** One line for every refusal the list reports, uploads included. */
  error: string | null
  /** Takes an upload's refusal, and null as a fresh pick clears the line. */
  setError: (message: string | null) => void
  retry: (view: RecordingView, kind: 'upload' | 'transcode') => void
  actionsFor: (view: RecordingView) => RowAction[]
  menuFor: (view: RecordingView) => MenuItem[]
  /** The recording the edit sheet shows, or null. */
  editing: RecordingView | null
  setEditing: (view: RecordingView | null) => void
  /** The recording the Add to tune sheet files, or null. */
  filing: RecordingView | null
  setFiling: (view: RecordingView | null) => void
  /** Adds dropped or picked audio files as unfiled recordings, reporting on `error`. */
  importFiles: (files: File[]) => Promise<void>
}

/** Import sources the user holds. */
function heldOrigins(views: readonly RecordingView[]): string[] {
  const held = new Set(views.map((view) => view.recording.origin))
  held.delete('own')
  return [...held]
}

/** Everything the Recordings screen reads and does. */
export function useRecordingsScreen({
  confirm,
  onOpenTune,
}: RecordingsScreenOptions): RecordingsScreen {
  const loadedViews = useRecordingsWithFiles()
  const [choice, choose] = useRecordingsOrigin()
  const ready = loadedViews !== undefined && choice !== undefined
  const views = loadedViews ?? NO_VIEWS
  const [filing, setFiling] = useState<RecordingView | null>(null)
  const [editing, setEditing] = useState<RecordingView | null>(null)
  const { error, setUploadError, retry, actionsFor, menuFor } = useRecordingActionsWith({
    confirm,
    onEdit: setEditing,
    onAddToTune: setFiling,
    onOpenTune: ({ tuneId }) => {
      if (tuneId) onOpenTune(tuneId)
    },
  })

  const origins = useMemo(() => heldOrigins(views), [views])
  const shown = useMemo(
    () =>
      choice === undefined || choice === 'all'
        ? views
        : views.filter((view) => view.recording.origin === choice),
    [views, choice],
  )

  const filterSet = choice !== undefined && choice !== 'all'
  const showsFilters = ready && (origins.length > 0 || filterSet)

  const sort = useRecordingsSort()
  const [query, setQueryState] = useState(() => readSearchQuery('recordings'))
  const setQuery = (value: string) => {
    setQueryState(value)
    writeSearchQuery('recordings', value)
  }
  const arrangement = useMemo(() => arrangeRecordings(shown, sort, query), [shown, sort, query])
  const listed = arrangedCount(arrangement)

  const importFiles = useAudioImport(null, setUploadError)

  return {
    ready,
    total: views.length,
    listed,
    countLabel: recordingCountLabel(listed, views.length),
    unfiled: arrangement.unfiled,
    filed: arrangement.filed,
    sort,
    setSort: setRecordingsSort,
    query,
    setQuery,
    source: choice ?? 'all',
    setSource: choose,
    origins,
    filterSet,
    showsFilters,
    error,
    setError: setUploadError,
    retry,
    actionsFor,
    menuFor,
    editing,
    setEditing,
    filing,
    setFiling,
    importFiles,
  }
}
