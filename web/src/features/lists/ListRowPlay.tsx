import { ArrowUpRight, CloudDownload } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import type { LocalRecordingLink } from '../../db/types'
import type { RowSource } from './useListRowSource'
import { closeLinkName, openLinkName } from '../links/linkNames'
import { useLinkRow } from '../links/useLinkRow'
import { useListPlayback } from '../player/useListPlayback'
import {
  closeRecordingName,
  downloadingName,
  downloadName,
  playName,
} from '../recordings/recordingNames'
import { useRecordingRow } from '../recordings/useRecordingRow'
import type { RecordingView } from '../recordings/useRecordings'
import { NotPlayableGlyph, PlayGlyph, StopGlyph } from '../../ui/rowGlyphs'

const SLOT = 'text-ink-2 grid size-(--target-control) shrink-0 place-items-center'

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

function SlotButton({
  name,
  loaded = false,
  onPress,
  children,
}: {
  name: string
  loaded?: boolean
  onPress: () => void
  children: ReactNode
}) {
  return (
    <AriaButton
      aria-label={name}
      onPress={onPress}
      className={`${SLOT} rounded-full data-[pressed]:opacity-60 ${loaded ? 'text-slate' : ''}`}
    >
      {children}
    </AriaButton>
  )
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
  const { control, loaded, open, offlineDownload } = useRecordingRow(view, {
    origin: { context: 'list', listId },
  })
  const listed = useListedPlay(listId, tuneId)
  if (control === 'downloading') {
    return (
      <span role="status" aria-label={downloadingName(title)} className={SLOT}>
        <CloudDownload className="size-5 opacity-40" aria-hidden />
      </span>
    )
  }
  if (!open) return <span className={SLOT} />
  const name =
    control === 'close'
      ? closeRecordingName(title)
      : control === 'play'
        ? playName(title)
        : downloadName(title)
  return (
    <SlotButton
      name={name}
      loaded={loaded}
      onPress={control === 'play' ? listed(open.onOpen) : open.onOpen}
    >
      {control === 'close' ? (
        <StopGlyph />
      ) : control === 'play' ? (
        <PlayGlyph />
      ) : (
        <CloudDownload className={`size-5 ${offlineDownload ? 'opacity-40' : ''}`} aria-hidden />
      )}
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
  const row = useLinkRow(link)
  const listed = useListedPlay(listId, tuneId)
  if (!row.open) return <span className={SLOT} />
  const name =
    row.control === 'close'
      ? closeLinkName(row.title)
      : row.control === 'play'
        ? playName(title)
        : openLinkName(row.title)
  return (
    <SlotButton
      name={name}
      loaded={row.loaded}
      // A tune whose row plays a link can still be in the queue by a recording.
      onPress={row.control === 'play' ? listed(row.open.onOpen) : row.open.onOpen}
    >
      {row.control === 'close' ? (
        <StopGlyph />
      ) : row.control === 'play' ? (
        <PlayGlyph />
      ) : (
        <ArrowUpRight className="size-5" aria-hidden />
      )}
    </SlotButton>
  )
}

/**
 * A list row's own play control, trailing: what the tune plays, named for the tune, or a mark
 * that it has nothing to play. Nothing shows until its media has read.
 */
export function ListRowPlay({
  source,
  title,
  listId,
  tuneId,
}: {
  source: RowSource | null | undefined
  /** The tune's title, which names the control. */
  title: string
  listId: string
  tuneId: string
}) {
  if (source === undefined) return <span className={SLOT} />
  if (source === null) {
    return (
      <span className={SLOT}>
        <NotPlayableGlyph />
      </span>
    )
  }
  return source.kind === 'recording' ? (
    <RecordingPlay view={source.view} title={title} listId={listId} tuneId={tuneId} />
  ) : (
    <LinkPlay link={source.link} title={title} listId={listId} tuneId={tuneId} />
  )
}
