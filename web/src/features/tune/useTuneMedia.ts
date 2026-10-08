import { useLiveQuery } from 'dexie-react-hooks'
import { CircleDot, Download, Link, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { removeLink } from '../../commands/links'
import { addRecordingFromLink } from '../../commands/recordings'
import { setPlaySource } from '../../commands/tunes'
import { PROVIDER_LABELS } from '../../constants'
import type { Provider } from '../../api/vocabulary'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLink, LocalUserTune } from '../../db/types'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import type { MenuItem } from '../../ui/menuTypes'
import type { RowAction } from '../../ui/rowTypes'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import {
  ADD_TO_RECORDINGS,
  FIND_RECORDINGS,
  SEARCH_NEEDS_CONNECTION,
  searchService,
} from '../links/findRecordingsCopy'
import {
  IMPORTABLE_PROVIDERS,
  openServiceSearch,
  prefillFor,
  searchesInApp,
  searchQuery,
} from '../links/serviceSearch'
import { PASTE_LINK } from '../links/pasteLinkCopy'
import { NEW_RECORDING } from '../recording/recordCopy'
import { retryKind } from '../recordings/recordingRow'
import { useRecordingActionsWith } from '../recordings/useRecordingActionsWith'
import type { RecordingView } from '../recordings/useRecordings'
import { useSearchProviders } from '../settings/searchProviders'
import { useResetOnChange } from '../../ui/useResetOnChange'
import { pinRowAction } from './playSourceText'

export interface RecordingMediaRow {
  view: RecordingView
  pinned: boolean
  actions: RowAction[]
  /** The file's upload refusal, when the row's retry is an upload. */
  error: string | null | undefined
}

export interface LinkMediaRow {
  link: LocalRecordingLink
  pinned: boolean
  actions: RowAction[]
}

export interface TuneMediaData {
  /** The tune's live user row, undefined until read or once it is gone. */
  userTune: LocalUserTune | undefined
  recordingRows: RecordingMediaRow[]
  linkRows: LinkMediaRow[]
  /** True when there is neither a recording nor a link to list. */
  empty: boolean
  /** One line for every refusal a row action or a retry reports. */
  error: string | null
  /** True while a row action is in flight. */
  pending: boolean
  retry: (view: RecordingView, kind: 'upload' | 'transcode') => void
  /** The ways to add a recording: record, paste a link, and find one. */
  addItems: MenuItem[]
  /** What a search starts from, the tune's name and type; empty until read. */
  prefill: string | undefined
  /** The one chosen search service, or null when none or several are chosen. */
  only: Provider | null
  pasting: boolean
  setPasting: (open: boolean) => void
  /** The recording whose edit sheet is open. */
  editing: RecordingView | null
  setEditing: (view: RecordingView | null) => void
  finding: boolean
  setFinding: (open: boolean) => void
}

/**
 * How a tune sounds: its recording and link rows with their actions, the pin they share, and
 * the ways to add one, as data for whichever screen draws them. The sheets those ways open are
 * the screen's; this holds only whether each is open.
 */
export function useTuneMedia(
  tuneId: string,
  {
    recordings,
    links,
    confirm,
    startRecording,
  }: {
    /** This tune's recordings in position order, read by the screen that mounts this. */
    recordings: readonly RecordingView[]
    links: readonly LocalRecordingLink[]
    confirm: (question: ConfirmQuestion) => Promise<boolean>
    /** Opens the recording flow filed under the tune. */
    startRecording: (tuneId: string) => void
  },
): TuneMediaData {
  const db = useDb()
  const online = useOnline()
  const engine = useSyncEngine()
  const providers = useSearchProviders()
  const [pasting, setPasting] = useState(false)
  const [editing, setEditing] = useState<RecordingView | null>(null)
  const [finding, setFinding] = useState(false)
  // No Add to tune: every recording here is already filed under the tune being looked at.
  // The pin is read here rather than passed down, so the rows that show it are the ones that
  // change it. A pin naming a row of another tune never matches one of this tune's rows.
  const userTune = useLiveQuery(
    async () =>
      (await db.user_tunes.where('tune_id').equals(tuneId).toArray()).find((u) => !u.deleted_at),
    [db, tuneId],
  )
  const pinnedRecordingId = userTune?.play_recording_id ?? null
  const pinnedLinkId = userTune?.play_link_id ?? null
  const { error, pending, run, retry, actionsFor, setUploadError } = useRecordingActionsWith({
    confirm,
    subject: tuneId,
    onEdit: setEditing,
    pin: userTune ? { userTuneId: userTune.id, recordingId: pinnedRecordingId } : undefined,
  })
  useResetOnChange(tuneId, () => {
    setPasting(false)
    setEditing(null)
    setFinding(false)
    setUploadError(null)
  })

  // One chosen service skips the list of services: the item names it and goes straight there.
  const only = providers?.size === 1 ? [...providers][0]! : null
  // Read ahead of the tap, since the tab has to open before anything is awaited.
  const prefill = useLiveQuery(async () => prefillFor(await db.tunes.get(tuneId)), [db, tuneId])
  const searchElsewhere = (provider: Provider) =>
    run(async () => {
      const message = await openServiceSearch(
        engine,
        searchQuery(prefill ?? ''),
        provider,
        PROVIDER_LABELS[provider],
      )
      if (message) throw new Error(message)
    })
  const find: MenuItem =
    only && !searchesInApp(only)
      ? {
          label: searchService(PROVIDER_LABELS[only]),
          icon: Search,
          opensTab: true,
          onPress: () => searchElsewhere(only),
        }
      : {
          label: only ? searchService(PROVIDER_LABELS[only]) : FIND_RECORDINGS,
          icon: Search,
          onPress: () => setFinding(true),
        }

  // A live recording that already came from this link's page is the link's audio saved.
  const canImport = (link: LocalRecordingLink) =>
    IMPORTABLE_PROVIDERS.some((provider) => provider === link.provider) &&
    !!link.provider_ref &&
    !recordings.some((view) => view.recording.origin_url === link.url)

  const linkActions = (link: LocalRecordingLink, pinned: boolean): RowAction[] => [
    ...(userTune
      ? [
          pinRowAction(pinned, () =>
            run(() =>
              setPlaySource(db, userTune.id, pinned ? null : { kind: 'link', id: link.id }),
            ),
          ),
        ]
      : []),
    ...(canImport(link)
      ? [
          {
            label: ADD_TO_RECORDINGS,
            short: 'Add',
            icon: Download,
            tone: 'neutral' as const,
            onPress: () => run(() => addRecordingFromLink(db, link.id)),
          },
        ]
      : []),
    {
      label: 'Remove',
      icon: Trash2,
      tone: 'error',
      onPress: () => run(() => removeLink(db, link.id)),
    },
  ]

  return {
    userTune,
    recordingRows: recordings.map((view) => ({
      view,
      pinned: view.recording.id === pinnedRecordingId,
      actions: actionsFor(view),
      error: retryKind(view) === 'upload' ? view.file?.error : null,
    })),
    linkRows: links.map((link) => {
      const pinned = link.id === pinnedLinkId
      return { link, pinned, actions: linkActions(link, pinned) }
    }),
    empty: recordings.length === 0 && links.length === 0,
    error,
    pending,
    retry,
    addItems: [
      { label: NEW_RECORDING, icon: CircleDot, onPress: () => startRecording(tuneId) },
      { label: PASTE_LINK, icon: Link, onPress: () => setPasting(true) },
      { ...find, refused: online ? undefined : SEARCH_NEEDS_CONNECTION },
    ],
    prefill,
    only,
    pasting,
    setPasting,
    editing,
    setEditing,
    finding,
    setFinding,
  }
}
