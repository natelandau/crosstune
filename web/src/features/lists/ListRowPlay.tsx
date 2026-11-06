import type { LocalRecordingLink } from '../../db/types'
import type { RowSource } from './useListRowSource'
import { closeLinkName, openLinkName } from '../links/linkNames'
import { useLinkRow } from '../links/useLinkRow'
import { tappedFrom, type PlayOrigin } from '../player/playLog'
import { useActiveListRun, useListPlayback } from '../player/useListPlayback'
import {
  closeRecordingName,
  downloadingName,
  downloadName,
  pauseName,
  playName,
} from '../recordings/recordingNames'
import { useRecordingRow } from '../recordings/useRecordingRow'
import type { RecordingView } from '../recordings/useRecordings'
import {
  ActionSlot,
  DownloadingGlyph,
  LinkControlGlyph,
  RecordingControlGlyph,
  SlotButton,
} from '../../ui/rowGlyphs'
import { NowPlayingControl } from './NowPlayingControl'

/** A tune played alone from its row in list `listId`. */
function rowOrigin(listId: string): PlayOrigin {
  return { context: 'list', listId, report: tappedFrom('list') }
}

/**
 * What a row's Play does: while this list plays, it moves the queue to the tune; otherwise,
 * or for a tune the queue lacks, it plays the row's own source, which detaches the queue.
 */
function useListedPlay(listId: string, tuneId: string): (playAlone: () => void) => () => void {
  const playback = useListPlayback()
  return (playAlone) => () => {
    if (playback.active?.listId === listId && playback.jump(tuneId)) return
    playAlone()
  }
}

function RecordingPlay({
  view,
  title,
  listId,
  tuneId,
}: {
  view: RecordingView
  title: string
  listId: string
  tuneId: string
}) {
  const { control, open, offlineDownload } = useRecordingRow(view, {
    origin: rowOrigin(listId),
  })
  const listed = useListedPlay(listId, tuneId)
  if (control === 'downloading') {
    return (
      <ActionSlot role="status" aria-label={downloadingName(title)}>
        <DownloadingGlyph />
      </ActionSlot>
    )
  }
  if (!open) return <ActionSlot />
  const name =
    control === 'close'
      ? closeRecordingName(title)
      : control === 'play'
        ? playName(title)
        : downloadName(title)
  return (
    <SlotButton name={name} onPress={control === 'play' ? listed(open.onOpen) : open.onOpen}>
      <RecordingControlGlyph control={control} offline={offlineDownload} />
    </SlotButton>
  )
}

function LinkPlay({
  link,
  title,
  listId,
  tuneId,
}: {
  link: LocalRecordingLink
  title: string
  listId: string
  tuneId: string
}) {
  const row = useLinkRow(link, rowOrigin(listId))
  const listed = useListedPlay(listId, tuneId)
  if (!row.open) return <ActionSlot />
  const name =
    row.control === 'close'
      ? closeLinkName(row.title)
      : row.control === 'play'
        ? playName(title)
        : openLinkName(row.title)
  return (
    <SlotButton
      name={name}
      // A tune whose row plays a link can still be in the queue by a recording.
      onPress={row.control === 'play' ? listed(row.open.onOpen) : row.open.onOpen}
    >
      <LinkControlGlyph control={row.control} />
    </SlotButton>
  )
}

/**
 * A list row's own play control, trailing: what the tune plays, named for the tune, or an empty
 * slot when it has nothing to play. On the tune a playing list is on, it pauses and resumes the
 * list. Nothing shows until its media has read.
 */
export function ListRowPlay({
  source,
  title,
  listId,
  tuneId,
  playing,
}: {
  source: RowSource | null | undefined
  /** The tune's title, which names the control. */
  title: string
  listId: string
  tuneId: string
  /** The player holds a recording or link of the tune. */
  playing: boolean
}) {
  const run = useActiveListRun(listId)
  if (playing && run) {
    return (
      <NowPlayingControl
        pauseName={pauseName(title)}
        playName={playName(title)}
        settled={run.settled}
      />
    )
  }
  // Empty but full width, so every key in the list stays in one column.
  if (source == null) return <ActionSlot />
  return source.kind === 'recording' ? (
    <RecordingPlay view={source.view} title={title} listId={listId} tuneId={tuneId} />
  ) : (
    <LinkPlay link={source.link} title={title} listId={listId} tuneId={tuneId} />
  )
}
