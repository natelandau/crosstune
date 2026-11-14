import { useLiveQuery } from 'dexie-react-hooks'
import { useRecordingsPlayable } from '../../billing/usePlan'
import { useDb } from '../../db/DbProvider'
import { isNotUploaded } from '../../db/recordings'
import { getLocalOnlyRows, type StorageUsage } from '../../db/meta'
import { OFFLINE } from '../../sync/labels'
import { useOnline } from '../../sync/SyncProvider'
import { usePremiumSheet, type PremiumEntry } from '../plan/PremiumSheetProvider'
import { TUNE_ROW_ORIGIN, type PlayOrigin } from '../player/playLog'
import { useOpenRecordingPage } from '../player/recordingPageOpener'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { DOWNLOAD_FAILED, formatDuration } from '../../text/format'
import type { Source } from '../../usage/events'
import type { RecordingSort } from './arrangeRecordings'
import {
  originLink,
  recordingMeta,
  recordingTitle,
  retryKind,
  rowControl,
  titleIsDate,
  type RowControl,
} from './recordingRow'
import { useDownload } from './useDownload'
import type { RecordingView } from './useRecordings'

export interface RecordingRowData {
  title: string
  /** The second line's parts, already worded, for the row to join with middle dots. */
  meta: string[]
  control: RowControl
  /** True while this recording is the player's loaded item. */
  loaded: boolean
  /** A download offered while offline: the slot keeps its press and dims, and says Offline. */
  offlineDownload: boolean
  /** A recording the plan does not play that has something to play: the row dims. */
  disabled: boolean
  /** What a press on the row's action slot does; undefined when the slot holds no control. */
  slot: (() => void) | undefined
  /** The row's own tap: the recording's page, or on a free plan the Plan sheet for it. */
  open: () => void
  retry: 'upload' | 'transcode' | null
  /** A failed download, unless the caller's own error line speaks first. */
  error: string | null
  /** The site an imported recording came from and its page there. */
  origin: { site: string; url: string } | null
}

/**
 * What one recording row shows and does, for every app's row: its slot plays what this device
 * holds, fetches what it does not, and says which retry a stuck recording needs.
 */
export function useRecordingRow(
  view: RecordingView,
  {
    tuneNamedAbove = false,
    sort,
    error,
    origin: playOrigin = TUNE_ROW_ORIGIN,
    premiumFrom = 'recording_row',
    pageSource = 'tune',
    storage = null,
  }: {
    tuneNamedAbove?: boolean
    sort?: RecordingSort
    /** The caller's own refusal for this row, such as a stuck upload's. */
    error?: string | null
    /** Where a play from this row counts as asked for. */
    origin?: PlayOrigin
    /** Where a free plan's press on the row or its play counts as opening the Plan sheet from. */
    premiumFrom?: PremiumEntry
    /** Where the recording's page counts as opened from. */
    pageSource?: Source
    /** The server's storage report, which the meta line reads for a file not yet uploaded. */
    storage?: StorageUsage | null
  } = {},
): RecordingRowData {
  const { recording, file } = view
  const db = useDb()
  const player = usePlayer()
  const premium = usePremiumSheet()
  const online = useOnline()
  const openPage = useOpenRecordingPage()
  const { fetch, download } = useDownload(recording.id)
  const title = recordingTitle(view, { tuneNamedAbove })
  const item = { kind: 'recording' as const, id: recording.id }
  const loaded = isPlaying(player, item)
  // Only a recording the server has not stored can be local-only, and a local-only recording goes
  // out as soon as the plan is Premium, so any other row skips the read.
  const free = !useRecordingsPlayable()
  const mayBeLocalOnly = recording.server_seq === 0 && free
  const localOnlyRow = useLiveQuery(
    async () => mayBeLocalOnly && (await getLocalOnlyRows(db)).has(recording.id),
    [db, mayBeLocalOnly, recording.id],
  )
  // A free plan uploads no audio, so audio not yet uploaded waits for Premium too.
  const localOnlyAudio = free && file?.local_state !== 'capturing' && isNotUploaded(file)
  const localOnly = (localOnlyRow ?? false) || localOnlyAudio
  const shownControl = rowControl(view, {
    loaded,
    downloading: fetch === 'fetching' || file?.local_state === 'downloading',
  })
  // A disabled row's slot keeps the play glyph; a download is never gated by the plan.
  const control =
    free && (shownControl === 'play' || shownControl === 'close') ? 'play' : shownControl
  const offlineDownload = control === 'download' && !online
  // A download control is only ever offered for a ready recording that is not local-only, so the
  // ordinary meta parts (tries, storage) never apply here; Offline takes the status word's place, the
  // way every other state does, rather than riding along as a suffix on the control's name.
  const meta = offlineDownload
    ? [formatDuration(recording.duration_ms ?? file?.local_duration_ms), OFFLINE].filter(
        (part): part is string => Boolean(part),
      )
    : recordingMeta(view, storage, {
        dateInTitle: titleIsDate(view, { tuneNamedAbove }),
        sort,
        localOnly,
      })

  const subject = { recordingId: recording.id }
  const open = free
    ? () => premium.open('recordings', premiumFrom, subject)
    : () => openPage?.(recording.id, { tuneId: view.tuneId, source: pageSource })

  const slot =
    control === 'close'
      ? () => player.close()
      : control === 'play'
        ? free
          ? open
          : () => player.play(item, { origin: playOrigin })
        : control === 'download'
          ? // Refused rather than disabled while offline, so the control keeps its press and
            // its name; Offline in the meta line says why.
            () => {
              if (online) download()
            }
          : undefined

  return {
    title,
    meta,
    control,
    loaded,
    offlineDownload,
    disabled: free && control === 'play',
    slot,
    open,
    retry: retryKind(view, { uploads: !free }),
    error: error ?? (fetch === 'failed' ? DOWNLOAD_FAILED : null),
    origin: originLink(recording),
  }
}
