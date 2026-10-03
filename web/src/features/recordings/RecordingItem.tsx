import { IonButton, IonLabel, IonSpinner } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CloudDownload } from 'lucide-react'
import { useDb } from '../../db/DbProvider'
import { getStorage } from '../../db/meta'
import { OFFLINE } from '../../sync/labels'
import { useOnline } from '../../sync/SyncProvider'
import { InlineError } from '../../ui/InlineError'
import { Row, type RowAction } from '../../ui/Row'
import { PinnedMark } from '../tune/PinnedMark'
import { CLOSE_PLAYER } from '../player/transportCopy'
import { PlayGlyph, Slot, StopGlyph } from '../../ui/rowGlyphs'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { DOWNLOAD_FAILED, formatDuration } from '../recording/format'
import { DOWNLOAD, downloadingName, PLAY } from './recordingNames'
import { recordingMeta, recordingTitle, retryKind, rowControl, titleIsDate } from './recordingRow'
import { useDownload } from './useDownload'
import type { RecordingView } from './useRecordings'

/**
 * The one row every recording list shows: it plays what this device holds, fetches what it does
 * not, and asks the musician to retry whichever of an upload or a transcode has stuck it. The
 * row itself is the play, close, or download control; its icon is decorative.
 */
export function RecordingItem({
  view,
  actions,
  error,
  tuneNamedAbove = false,
  pinned = false,
  onRetry,
}: {
  view: RecordingView
  /** True for the recording a list plays for its tune. */
  pinned?: boolean
  actions?: readonly RowAction[]
  /** Shown under the meta line, for a stuck upload or a failed download. */
  error?: string | null
  /** True in a list whose heading above this row already names the recording's tune. */
  tuneNamedAbove?: boolean
  onRetry: (kind: 'upload' | 'transcode') => void
}) {
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
  const retry = retryKind(view)
  const offlineDownload = control === 'download' && !online
  // A download control is only ever offered for a ready, not-held recording, so the ordinary
  // meta parts (tries, storage) never apply here; Offline takes the status word's place, the
  // way every other state does, rather than riding along as a suffix on the control's name.
  const metaParts = offlineDownload
    ? [formatDuration(recording.duration_ms ?? file?.local_duration_ms), OFFLINE].filter(
        (part): part is string => Boolean(part),
      )
    : recordingMeta(view, storage ?? null, { dateInTitle: titleIsDate(view, { tuneNamedAbove }) })
  const meta = metaParts.join(' · ')

  const open =
    control === 'close'
      ? { onOpen: () => player.close(), openName: CLOSE_PLAYER }
      : control === 'play'
        ? { onOpen: () => player.play(item), openName: PLAY }
        : control === 'download'
          ? {
              // Refused rather than disabled while offline, so the control keeps its tap and
              // its name; Offline in the meta line says why, not a state Ionic drops on touch.
              onOpen: () => {
                if (online) download()
              },
              openName: DOWNLOAD,
            }
          : undefined

  let start
  if (control === 'play' || control === 'close') {
    start = <Slot>{control === 'close' ? <StopGlyph /> : <PlayGlyph />}</Slot>
  } else if (control === 'download') {
    start = (
      <Slot>
        <CloudDownload
          aria-hidden="true"
          className={`size-5 shrink-0 ${offlineDownload ? 'opacity-60' : ''}`}
        />
      </Slot>
    )
  } else if (control === 'downloading') {
    start = (
      <div slot="start" role="status" aria-label={downloadingName(title)}>
        <Slot>
          <IonSpinner aria-hidden="true" />
        </Slot>
      </div>
    )
  } else {
    start = <Slot />
  }

  const end = retry ? (
    <IonButton
      fill="clear"
      className="row-action"
      aria-label={retry === 'upload' ? `Retry uploading ${title}` : `Retry ${title}`}
      onClick={() => onRetry(retry)}
    >
      Retry
    </IonButton>
  ) : undefined

  const shownError = error ?? (fetch === 'failed' ? DOWNLOAD_FAILED : null)

  return (
    <Row
      name={title}
      actions={actions}
      dimmed={offlineDownload}
      start={start}
      end={end}
      note={shownError ? <InlineError>{shownError}</InlineError> : undefined}
      {...open}
    >
      <IonLabel className="my-2.5 overflow-hidden">
        {/* A level below the heading of the group this row sits in, which is a tune's own row. */}
        <div className="flex items-center gap-1.5">
          <h3 className="type-headline truncate">{title}</h3>
          {pinned ? <PinnedMark /> : null}
        </div>
        <p className="type-subheadline truncate tabular-nums">{meta}</p>
      </IonLabel>
    </Row>
  )
}
