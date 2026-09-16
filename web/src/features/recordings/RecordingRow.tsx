import { useLiveQuery } from 'dexie-react-hooks'
import { CloudDownload } from 'lucide-react'
import { useState } from 'react'
import { SwipeRow, type SwipeActions } from '../../components/SwipeRow'
import type { SwipeRowState } from '../../components/swipe'
import { useDb } from '../../db/DbProvider'
import { getStorage } from '../../db/meta'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import { failedTriesLabel, fileStateLabel, formatBytes, formatDuration } from '../recording/format'
import { PlayGlyph, ROW_CLASS, Slot, StopGlyph } from '../player/rowGlyphs'
import { isPlaying, usePlayer } from '../player/usePlayer'
import type { RecordingView } from './useRecordings'

function recordedAtLabel(recordedAt: string): string {
  return new Date(recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * A recording as a swipeable row. The row itself is the one control: it plays a recording this
 * device holds, fetches one it does not, and does nothing for one the server is still preparing.
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
  actions: SwipeActions
  onRetry: (id: string) => void
  onRetryUpload: (id: string) => void
}) {
  const { recording, file, songTitle } = view
  const db = useDb()
  const engine = useSyncEngine()
  const player = usePlayer()
  const online = useOnline()
  // A tap's download is tracked here because a recording with no file row yet has nowhere
  // durable to carry that state; the download pass marks the row itself.
  const [fetch, setFetch] = useState<'idle' | 'fetching' | 'failed'>('idle')
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
  // The player keeps its item whether or not the blob is still here, so a playing row must
  // offer Stop even after its download was cleared.
  const loaded = isPlaying(player, item)
  const downloadable = !held && recording.state === 'ready'
  const downloading = downloadable && (fetch === 'fetching' || file?.local_state === 'downloading')
  const attempts = file?.upload_attempts ?? 0
  const waiting = file?.local_state === 'captured' || file?.local_state === 'uploading'
  const tries = waiting && attempts > 0 ? failedTriesLabel(attempts) : null
  // A refused upload, or one the loop keeps failing to send, is stuck until the musician acts.
  const uploadStuck =
    file?.local_state === 'failed_upload' || (file?.local_state === 'captured' && attempts > 0)
  const errorLine =
    uploadStuck && file.error ? file.error : fetch === 'failed' ? "Couldn't download" : null
  const retry = uploadStuck
    ? { label: `Retry uploading ${title}`, onClick: () => onRetryUpload(recording.id) }
    : recording.state === 'failed'
      ? { label: `Retry ${title}`, onClick: () => onRetry(recording.id) }
      : null

  const download = () => {
    setFetch('fetching')
    void engine.download(recording.id).then((blob) => setFetch(blob ? 'idle' : 'failed'))
  }

  const text = (
    <span className="min-w-0 flex-1">
      <span className="block truncate font-medium">{title}</span>
      <span className="text-small block truncate opacity-70">
        {/* A recording that needs nothing from the user shows when it was made instead of a status. */}
        {[duration, status || recordedAtLabel(recording.recorded_at), tries, storageLabel]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {errorLine ? <span className="text-error text-small block">{errorLine}</span> : null}
    </span>
  )
  const cardClass = `${ROW_CLASS} pr-3`

  let card
  if (held || loaded) {
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
          {retry ? (
            <button
              type="button"
              className="btn btn-sm mr-2 min-h-11"
              onClick={retry.onClick}
              aria-label={retry.label}
            >
              Retry
            </button>
          ) : null}
        </div>
      </SwipeRow>
    </li>
  )
}
