import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { getStorage } from '../../db/meta'
import { OFFLINE } from '../../sync/labels'
import { useOnline } from '../../sync/SyncProvider'
import { CLOSE_PLAYER } from '../player/transportCopy'
import type { PlayOrigin } from '../player/playLog'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { DOWNLOAD_FAILED, formatDuration } from '../recording/format'
import type { RecordingSort } from './arrangeRecordings'
import { DOWNLOAD, PLAY } from './recordingNames'
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

const ROW_ORIGIN: PlayOrigin = { context: 'row' }

export interface RecordingRowData {
  title: string
  /** The second line's parts, already worded, for the row to join with middle dots. */
  meta: string[]
  control: RowControl
  /** True while this recording is the player's loaded item. */
  loaded: boolean
  /** A download offered while offline: the row keeps its tap and dims, and says Offline. */
  offlineDownload: boolean
  /** What a tap on the row does and the verb that names it; undefined when it does nothing. */
  open: { onOpen: () => void; openName: string } | undefined
  retry: 'upload' | 'transcode' | null
  /** A failed download, unless the caller's own error line speaks first. */
  error: string | null
  /** The site an imported recording came from and its page there. */
  origin: { site: string; url: string } | null
}

/**
 * What one recording row shows and does, for every app's row: it plays what this device holds,
 * fetches what it does not, and says which retry a stuck recording needs.
 */
export function useRecordingRow(
  view: RecordingView,
  {
    tuneNamedAbove = false,
    sort,
    error,
    origin: playOrigin = ROW_ORIGIN,
  }: {
    tuneNamedAbove?: boolean
    sort?: RecordingSort
    /** The caller's own refusal for this row, such as a stuck upload's. */
    error?: string | null
    /** Where a play from this row counts as asked for. */
    origin?: PlayOrigin
  } = {},
): RecordingRowData {
  const { recording, file } = view
  const db = useDb()
  const player = usePlayer()
  const online = useOnline()
  const { fetch, download } = useDownload(recording.id)
  const title = recordingTitle(view, { tuneNamedAbove })
  const item = { kind: 'recording' as const, id: recording.id }
  const loaded = isPlaying(player, item)
  const blockedQuota = file?.local_state === 'blocked_quota'
  const storage = useLiveQuery(
    () => (blockedQuota ? getStorage(db) : undefined),
    [db, blockedQuota],
  )
  const control = rowControl(view, {
    loaded,
    downloading: fetch === 'fetching' || file?.local_state === 'downloading',
  })
  const offlineDownload = control === 'download' && !online
  // A download control is only ever offered for a ready, not-held recording, so the ordinary
  // meta parts (tries, storage) never apply here; Offline takes the status word's place, the
  // way every other state does, rather than riding along as a suffix on the control's name.
  const meta = offlineDownload
    ? [formatDuration(recording.duration_ms ?? file?.local_duration_ms), OFFLINE].filter(
        (part): part is string => Boolean(part),
      )
    : recordingMeta(view, storage ?? null, {
        dateInTitle: titleIsDate(view, { tuneNamedAbove }),
        sort,
      })

  const open =
    control === 'close'
      ? { onOpen: () => player.close(), openName: CLOSE_PLAYER }
      : control === 'play'
        ? { onOpen: () => player.play(item, playOrigin), openName: PLAY }
        : control === 'download'
          ? {
              // Refused rather than disabled while offline, so the control keeps its tap and
              // its name; Offline in the meta line says why.
              onOpen: () => {
                if (online) download()
              },
              openName: DOWNLOAD,
            }
          : undefined

  return {
    title,
    meta,
    control,
    loaded,
    offlineDownload,
    open,
    retry: retryKind(view),
    error: error ?? (fetch === 'failed' ? DOWNLOAD_FAILED : null),
    origin: originLink(recording),
  }
}
