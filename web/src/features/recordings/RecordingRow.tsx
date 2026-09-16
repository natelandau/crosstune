import { useLiveQuery } from 'dexie-react-hooks'
import { CloudDownload } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { SwipeRow, type SwipeAction } from '../../components/SwipeRow'
import type { SwipeRowState } from '../../components/swipe'
import { useDb } from '../../db/DbProvider'
import { getStorage } from '../../db/meta'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import { fileStateLabel, formatBytes, formatDuration } from '../recording/format'
import { PlayGlyph, StopGlyph } from '../player/PlayButton'
import { isPlaying, usePlayer } from '../player/usePlayer'
import type { RecordingView } from './useRecordings'

function recordedAtLabel(recordedAt: string): string {
  return new Date(recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** The slot before a take's title, sized to the row's touch target whatever it holds. */
function Slot({ children }: { children?: ReactNode }) {
  return <span className="flex size-11 shrink-0 items-center justify-center">{children}</span>
}

/**
 * A take as a swipeable row. The row itself is the one control: it plays a take this device
 * holds, fetches one it does not, and does nothing for one the server is still preparing.
 * Its actions live behind a swipe.
 */
export function RecordingRow({
  view,
  actions,
  onRetry,
  onRetryUpload,
  ...rowState
}: SwipeRowState & {
  view: RecordingView
  actions: readonly [SwipeAction, SwipeAction]
  onRetry: (id: string) => void
  onRetryUpload: (id: string) => void
}) {
  const { recording, file, songTitle } = view
  const db = useDb()
  const engine = useSyncEngine()
  const player = usePlayer()
  const online = useOnline()
  const [fetching, setFetching] = useState(false)
  const [fetchFailed, setFetchFailed] = useState(false)
  const title =
    recording.label ?? songTitle ?? `Recording, ${recordedAtLabel(recording.recorded_at)}`
  const blockedQuota = file?.local_state === 'blocked_quota'
  const storage = useLiveQuery(
    () => (blockedQuota ? getStorage(db) : undefined),
    [db, blockedQuota],
  )
  const status = fileStateLabel(recording, file)
  const storageLabel =
    blockedQuota && storage
      ? `${formatBytes(storage.used_bytes)} of ${formatBytes(storage.quota_bytes)} used`
      : null
  const duration = formatDuration(recording.duration_ms ?? file?.local_duration_ms)
  const item = { kind: 'recording' as const, id: recording.id }
  const held = !!file?.blob
  const loaded = held && isPlaying(player, item)
  const downloadable = !held && recording.state === 'ready'
  // The download pass marks a row it is fetching; a tap here is tracked locally because a
  // recording with no file row yet has nowhere to carry that state.
  const downloading = downloadable && (fetching || file?.local_state === 'downloading')
  const uploadFailed = file?.local_state === 'failed_upload'
  const errorLine =
    uploadFailed && file.error ? file.error : fetchFailed ? "Couldn't download" : null

  const download = () => {
    setFetching(true)
    setFetchFailed(false)
    void engine.download(recording.id).then((blob) => {
      setFetching(false)
      if (!blob) setFetchFailed(true)
    })
  }

  const text = (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">{title}</span>
      <span className="block truncate text-xs opacity-70">
        {/* A take that needs nothing from the user shows when it was made instead of a status. */}
        {[duration, status || recordedAtLabel(recording.recorded_at), storageLabel]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {errorLine ? <span className="text-error block text-xs">{errorLine}</span> : null}
    </span>
  )
  const cardClass = 'flex min-h-14 min-w-0 flex-1 items-center gap-1 py-2 pr-3 pl-1 text-left'

  let card: ReactNode
  if (held) {
    card = (
      <button
        type="button"
        className={cardClass}
        onClick={() => (loaded ? player.close() : player.play(item))}
        aria-label={loaded ? `Close ${title} player` : `Play ${title}`}
      >
        <Slot>{loaded ? <StopGlyph /> : <PlayGlyph />}</Slot>
        {text}
      </button>
    )
  } else if (downloading) {
    card = (
      <div className={cardClass} role="status" aria-label={`Downloading ${title}`}>
        <Slot>
          <span className="loading loading-spinner loading-sm" />
        </Slot>
        {text}
      </div>
    )
  } else if (downloadable) {
    card = (
      <button
        type="button"
        className={`${cardClass} ${online ? '' : 'opacity-60'}`}
        // Refused rather than disabled while offline, so the row keeps its control and its name.
        onClick={() => {
          if (online) download()
        }}
        aria-disabled={online ? undefined : true}
        aria-label={`Download ${title}`}
      >
        <Slot>
          <CloudDownload aria-hidden="true" className="size-5 shrink-0" />
        </Slot>
        {text}
      </button>
    )
  } else {
    card = (
      <div className={cardClass}>
        <Slot />
        {text}
      </div>
    )
  }

  return (
    <li>
      <SwipeRow name={title} actions={actions} {...rowState}>
        <div className="rounded-box flex items-center">
          {card}
          {uploadFailed ? (
            <button
              type="button"
              className="btn btn-sm mr-2 min-h-11"
              onClick={() => onRetryUpload(recording.id)}
              aria-label={`Retry uploading ${title}`}
            >
              Retry
            </button>
          ) : recording.state === 'failed' ? (
            <button
              type="button"
              className="btn btn-sm mr-2 min-h-11"
              onClick={() => onRetry(recording.id)}
              aria-label={`Retry ${title}`}
            >
              Retry
            </button>
          ) : null}
        </div>
      </SwipeRow>
    </li>
  )
}
