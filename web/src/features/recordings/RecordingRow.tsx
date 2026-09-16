import { Link } from '@tanstack/react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from '../../db/DbProvider'
import { getStorage } from '../../db/meta'
import { useOnline } from '../../sync/SyncProvider'
import { fileStateLabel, formatBytes, formatDuration } from '../recording/format'
import { PlayButton } from '../player/PlayButton'
import { isPlaying, usePlayer } from '../player/usePlayer'
import type { RecordingView } from './useRecordings'

function recordedAtLabel(recordedAt: string): string {
  return new Date(recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function RecordingRow({
  view,
  showSong,
  onDelete,
  onRetry,
  onRetryUpload,
  onAttach,
}: {
  view: RecordingView
  showSong: boolean
  onDelete: (id: string) => void
  onRetry: (id: string) => void
  onRetryUpload: (id: string) => void
  onAttach?: (id: string) => void
}) {
  const { recording, file, songId, songTitle } = view
  const db = useDb()
  const player = usePlayer()
  const online = useOnline()
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
  const playable = !!file?.blob || (recording.state === 'ready' && online)
  const loaded = isPlaying(player, item)
  const uploadFailed = file?.local_state === 'failed_upload'
  return (
    <li className="bg-base-200 rounded-box flex min-h-14 items-center gap-3 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        <span className="block truncate text-xs opacity-70">
          {[showSong && songTitle, duration, status, storageLabel].filter(Boolean).join(' · ')}
        </span>
        {uploadFailed && file.error ? (
          <span className="text-error block text-xs">{file.error}</span>
        ) : null}
      </span>
      {uploadFailed ? (
        <button
          type="button"
          className="btn btn-sm min-h-11"
          onClick={() => onRetryUpload(recording.id)}
          aria-label={`Retry uploading ${title}`}
        >
          Retry
        </button>
      ) : recording.state === 'failed' ? (
        <button
          type="button"
          className="btn btn-sm min-h-11"
          onClick={() => onRetry(recording.id)}
          aria-label={`Retry ${title}`}
        >
          Retry
        </button>
      ) : null}
      {!songId && onAttach ? (
        <button
          type="button"
          className="btn btn-sm min-h-11"
          onClick={() => onAttach(recording.id)}
          aria-label={`Add ${title} to a song`}
        >
          Add to song
        </button>
      ) : null}
      {showSong && songId ? (
        <Link
          to="/songs/$id"
          params={{ id: songId }}
          className="btn btn-ghost btn-sm min-h-11"
          aria-label={`Open ${songTitle}`}
        >
          Open
        </Link>
      ) : null}
      {playable ? (
        <PlayButton
          title={title}
          loaded={loaded}
          onPlay={() => player.play(item)}
          onClose={player.close}
        />
      ) : null}
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-11 min-w-11"
        onClick={() => onDelete(recording.id)}
        aria-label={`Delete ${title}`}
      >
        ✕
      </button>
    </li>
  )
}
