import { IonSpinner } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowUpRight, CloudDownload } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { activeByPosition } from '../../commands/write'
import { useDb } from '../../db/DbProvider'
import type { PlayFirst } from '../../api/vocabulary'
import type { LocalRecordingLink } from '../../db/types'
import { useOnline } from '../../sync/SyncProvider'
import { NotPlayableGlyph, PlayGlyph, Slot, StopGlyph } from '../../ui/rowGlyphs'
import { TuneItem } from '../catalog/TuneItem'
import { displayTitle } from '../links/display'
import { closeLinkName, openLinkName } from '../links/linkNames'
import { linkControl } from '../links/linkControl'
import { chooseRowSource } from '../player/tuneSource'
import { isPlaying, usePlayer } from '../player/usePlayer'
import {
  closeRecordingName,
  downloadingName,
  downloadName,
  playName,
} from '../recordings/recordingNames'
import { rowControl } from '../recordings/recordingRow'
import { useDownload } from '../recordings/useDownload'
import { useRecordingsWithFiles, type RecordingView } from '../recordings/useRecordings'
import type { ListItemView } from './useLists'

export const NOT_PLAYABLE = 'No recordings or links'

type RowSource =
  { kind: 'recording'; view: RecordingView } | { kind: 'link'; link: LocalRecordingLink }

/**
 * What a list row plays for its tune: `null` when it has nothing, `undefined` until its media
 * has been read. Reads the tune's own media in tune-screen order, because a row's view carries
 * none.
 */
function useRowSource(
  entry: ListItemView,
  playFirst: PlayFirst | undefined,
): RowSource | null | undefined {
  const db = useDb()
  const tuneId = entry.tune.id
  const views = useRecordingsWithFiles({ tuneId })
  const links = useLiveQuery(
    async () =>
      activeByPosition(await db.recording_links.where('tune_id').equals(tuneId).toArray()),
    [db, tuneId],
  )
  if (!views || !links || playFirst === undefined) return undefined
  const chosen = chooseRowSource({
    tuneId,
    pin: {
      recordingId: entry.userTune.play_recording_id ?? null,
      linkId: entry.userTune.play_link_id ?? null,
    },
    recordings: views.map((view) => view.recording),
    links,
    playFirst,
  })
  if (!chosen) return null
  if (chosen.kind === 'link') {
    const link = links.find((l) => l.id === chosen.id)
    return link ? { kind: 'link', link } : null
  }
  const view = views.find((v) => v.recording.id === chosen.id)
  return view ? { kind: 'recording', view } : null
}

/** One of a row's trailing controls, at the row's touch size. */
function RowButton({
  name,
  onClick,
  children,
}: {
  name: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" aria-label={name} className={SLOT} onClick={onClick}>
      {children}
    </button>
  )
}

const SLOT = 'grid size-11 place-items-center'

function RecordingPlay({ view, title }: { view: RecordingView; title: string }) {
  const player = usePlayer()
  const online = useOnline()
  const { recording, file } = view
  const { fetch, download } = useDownload(recording.id)
  const item = { kind: 'recording' as const, id: recording.id }
  const control = rowControl(view, {
    loaded: isPlaying(player, item),
    downloading: fetch === 'fetching' || file?.local_state === 'downloading',
  })

  if (control === 'close') {
    return (
      <RowButton name={closeRecordingName(title)} onClick={() => player.close()}>
        <StopGlyph />
      </RowButton>
    )
  }
  if (control === 'play') {
    return (
      <RowButton name={playName(title)} onClick={() => player.play(item)}>
        <PlayGlyph />
      </RowButton>
    )
  }
  if (control === 'download') {
    return (
      <RowButton
        name={downloadName(title)}
        // Refused rather than disabled, so the control keeps its tap and its name.
        onClick={() => {
          if (online) download()
        }}
      >
        <CloudDownload aria-hidden="true" className={`size-5 ${online ? '' : 'opacity-60'}`} />
      </RowButton>
    )
  }
  if (control === 'downloading') {
    return (
      <span role="status" aria-label={downloadingName(title)} className={SLOT}>
        <IonSpinner aria-hidden="true" />
      </span>
    )
  }
  return <span className="size-11" />
}

function LinkPlay({ link, title }: { link: LocalRecordingLink; title: string }) {
  const player = usePlayer()
  const item = { kind: 'link' as const, id: link.id }
  const { control, href } = linkControl(link, isPlaying(player, item))
  const linkName = displayTitle(link)

  if (control === 'close') {
    return (
      <RowButton name={closeLinkName(linkName)} onClick={() => player.close()}>
        <StopGlyph />
      </RowButton>
    )
  }
  if (control === 'play') {
    return (
      <RowButton name={playName(title)} onClick={() => player.play(item)}>
        <PlayGlyph />
      </RowButton>
    )
  }
  if (control === 'open') {
    return (
      <RowButton
        name={openLinkName(linkName)}
        onClick={() => window.open(href!, '_blank', 'noopener,noreferrer')}
      >
        <ArrowUpRight aria-hidden="true" className="size-5" />
      </RowButton>
    )
  }
  return <span className="size-11" />
}

/** The play control a list row carries first in its trailing edge. */
function ListRowPlay({ source, title }: { source: RowSource | null; title: string }) {
  if (!source) {
    return (
      <Slot>
        <NotPlayableGlyph />
      </Slot>
    )
  }
  return source.kind === 'recording' ? (
    <RecordingPlay view={source.view} title={title} />
  ) : (
    <LinkPlay link={source.link} title={title} />
  )
}

/**
 * A tune row in a list: the tune, its play control first in the trailing edge, then `trailing`.
 * While selecting, the row toggles and carries no play control.
 */
export function ListTuneRow({
  entry,
  playFirst,
  trailing,
  ...rest
}: Omit<ComponentProps<typeof TuneItem>, 'entry' | 'end' | 'description'> & {
  entry: ListItemView
  /** The user's play-first choice, undefined until the settings row has been read. */
  playFirst: PlayFirst | undefined
  trailing?: ReactNode
}) {
  const source = useRowSource(entry, playFirst)
  const selecting = rest.selection !== undefined
  const shown = !selecting && source !== undefined
  return (
    <TuneItem
      {...rest}
      entry={entry}
      description={shown && source === null ? NOT_PLAYABLE : undefined}
      end={
        shown || trailing ? (
          <>
            {shown ? <ListRowPlay source={source} title={entry.tune.title} /> : null}
            {trailing}
          </>
        ) : null
      }
    />
  )
}
