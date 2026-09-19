import { IonLabel } from '@ionic/react'
import { Fragment, type ReactNode } from 'react'
import type { Instrument } from '../../db/types'
import { Row, type RowAction } from '../../ui/Row'
import { selectionCheckboxId } from '../selection/ids'
import type { RowSelection } from '../selection/useSelection'
import { TUNING_FIELDS, TUNING_FIELD_NAMES } from '../settings/instruments'
import type { CatalogEntry } from './filters'
import { isSongStatus, STATUS_LABELS } from './status'

const DOT = {
  known: 'bg-(--ion-color-success)',
  learning: 'bg-(--ion-color-warning)',
  want_to_learn: 'border-2 border-(--ion-color-medium)',
} as const

/** A status is never color alone: the dot always sits beside its label. */
export function StatusDot({ status }: { status: string }) {
  const known = isSongStatus(status) ? status : 'want_to_learn'
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span aria-hidden="true" className={`size-2.5 rounded-full ${DOT[known]}`} />
      {STATUS_LABELS[known]}
    </span>
  )
}

/** The line under a song's title: its key, its status, the tunings played, and whether it is archived. */
export function SongMeta({
  entry: { song, userSong },
  instruments,
}: {
  entry: CatalogEntry
  instruments: ReadonlySet<Instrument>
}) {
  const tunings = TUNING_FIELD_NAMES.filter((field) =>
    instruments.has(TUNING_FIELDS[field].instrument),
  )
    .map((field) => song[field])
    .filter(Boolean)
    .join(' · ')
  // Adjacent spans with only visual (flex-gap) spacing read as one run-on word to a screen
  // reader, so an sr-only comma marks each part boundary without changing the visible layout.
  const parts: ReactNode[] = []
  if (song.key) {
    parts.push(
      <span className="font-semibold text-(--ion-text-color) tabular-nums">
        <span className="sr-only">Key </span>
        {song.key}
      </span>,
    )
  }
  parts.push(<StatusDot status={userSong.status} />)
  if (tunings) parts.push(<span className="truncate tabular-nums">{tunings}</span>)
  if (userSong.archived_at !== null) parts.push(<span>Archived</span>)
  return (
    <p data-song-meta className="type-subheadline flex min-w-0 items-center gap-3">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <span className="sr-only">, </span> : null}
          {part}
        </Fragment>
      ))}
    </p>
  )
}

/** A song's two lines, title then meta, as the label of whatever row shows them. */
export function SongLines({
  entry,
  instruments,
  silent = false,
}: {
  entry: CatalogEntry
  instruments: ReadonlySet<Instrument>
  /** Keeps these lines out of the accessibility tree, for a control that carries its own name. */
  silent?: boolean
}) {
  return (
    // Ionic makes a label's heading inherit the label's overflow, so the title's ellipsis needs
    // the label to clip. Ionic's wrapper hands a prop straight to the element, which drops a
    // boolean aria-hidden, so that one is written as the string the attribute takes.
    <IonLabel aria-hidden={silent ? 'true' : undefined} className="my-2.5 overflow-hidden">
      <h2 className="type-headline truncate">{entry.song.title}</h2>
      <SongMeta entry={entry} instruments={instruments} />
    </IonLabel>
  )
}

/** The one song row, wherever songs are listed. */
export function SongItem({
  entry,
  instruments,
  onOpen,
  actions,
  selection,
  onLongPress,
  start,
  end,
}: {
  entry: CatalogEntry
  instruments: ReadonlySet<Instrument>
  /** Opens the song. While `selection` is present the row toggles instead. */
  onOpen?: () => void
  actions?: readonly RowAction[]
  /**
   * The row's place in an open selection, present only while the mode is on. One object rather
   * than a set of props each screen flips in lockstep: the check mark, the verb, the id focus
   * moves to, the toggle, the stilled swipe actions, and the stilled long press all follow from
   * it, so no screen can wire one of them and forget another.
   */
  selection?: RowSelection
  /** Enters selection on touch, for a screen that hosts it. */
  onLongPress?: () => void
  start?: ReactNode
  end?: ReactNode
}) {
  const { song, userSong } = entry
  const archived = userSong.archived_at !== null
  const selecting = selection !== undefined
  return (
    <Row
      name={song.title}
      onOpen={selection ? selection.onToggle : onOpen}
      openName={selection ? (selection.selected ? 'Deselect' : 'Select') : undefined}
      actions={actions}
      disabled={selecting}
      dimmed={archived}
      selected={selection?.selected}
      openId={selecting ? selectionCheckboxId(userSong.id) : undefined}
      onLongPress={selecting ? undefined : onLongPress}
      start={start}
      end={end}
    >
      <SongLines entry={entry} instruments={instruments} />
    </Row>
  )
}
