import { IonLabel } from '@ionic/react'
import { Fragment, type ReactNode } from 'react'
import { INSTRUMENTS, type Instrument } from '../../api/vocabulary'
import { STATUS_LABELS } from '../../constants'
import { KeyPill } from '../../ui/KeyPill'
import { Row, type RowAction } from '../../ui/Row'
import { selectionCheckboxId } from '../selection/ids'
import type { RowSelection } from '../selection/useSelection'
import { tuningSummary } from '../settings/instruments'
import type { CatalogEntry } from './filters'
import { isTuneStatus } from './status'

const DOT = {
  known: 'bg-(--ion-color-success)',
  learning: 'bg-(--ion-color-warning)',
  want_to_learn: 'border-2 border-(--ion-color-medium)',
} as const

/** A status is never color alone: the dot always sits beside its label. */
export function StatusDot({ status }: { status: string }) {
  const known = isTuneStatus(status) ? status : 'want_to_learn'
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span aria-hidden="true" className={`size-2.5 rounded-full ${DOT[known]}`} />
      {STATUS_LABELS[known]}
    </span>
  )
}

/** The line under a tune's title: its key, its status, the tunings played, and whether it is archived. */
export function TuneMeta({
  entry: { tune, userTune },
  instruments,
}: {
  entry: CatalogEntry
  instruments: ReadonlySet<Instrument>
}) {
  // A player of one instrument knows whose tuning it is; two instruments can share a name.
  const withInstrument = instruments.size > 1
  const tunings = INSTRUMENTS.filter((instrument) => instruments.has(instrument))
    .map((instrument) => tuningSummary(instrument, tune.tunings, { withInstrument }))
    .filter(Boolean)
    .join(' · ')
  // Adjacent spans with only visual (flex-gap) spacing read as one run-on word to a screen
  // reader, so an sr-only comma marks each part boundary without changing the visible layout.
  const parts: ReactNode[] = []
  if (tune.key) {
    parts.push(
      <span className="inline-flex items-center">
        <span className="sr-only">Key </span>
        <KeyPill value={tune.key} compact />
      </span>,
    )
  }
  parts.push(<StatusDot status={userTune.status} />)
  if (tunings) parts.push(<span className="truncate tabular-nums">{tunings}</span>)
  if (userTune.archived_at !== null) parts.push(<span>Archived</span>)
  return (
    <p data-tune-meta className="type-subheadline flex min-w-0 items-center gap-3">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <span className="sr-only">, </span> : null}
          {part}
        </Fragment>
      ))}
    </p>
  )
}

/** A tune's two lines, title then meta, as the label of whatever row shows them. */
export function TuneLines({
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
      <h2 className="type-headline truncate">{entry.tune.title}</h2>
      <TuneMeta entry={entry} instruments={instruments} />
    </IonLabel>
  )
}

/** The one tune row, wherever tunes are listed. */
export function TuneItem({
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
  /** Opens the tune. While `selection` is present the row toggles instead. */
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
  const { tune, userTune } = entry
  const archived = userTune.archived_at !== null
  const selecting = selection !== undefined
  return (
    <Row
      name={tune.title}
      onOpen={selection ? selection.onToggle : onOpen}
      openName={selection ? (selection.selected ? 'Deselect' : 'Select') : undefined}
      actions={actions}
      disabled={selecting}
      dimmed={archived}
      selected={selection?.selected}
      openId={selecting ? selectionCheckboxId(userTune.id) : undefined}
      onLongPress={selecting ? undefined : onLongPress}
      start={start}
      end={end}
    >
      <TuneLines entry={entry} instruments={instruments} />
    </Row>
  )
}
