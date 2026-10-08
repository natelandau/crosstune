import { Archive, ArchiveRestore, ListChecks, SquarePen, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Key } from 'react-aria-components'
import type { Instrument } from '../../api/vocabulary'
import { STATUS_LABELS } from '../../constants'
import { effectiveStatus, type CatalogEntry } from './filters'
import { SELECT } from '../selection/selectionCopy'
import { playedTunings } from '../settings/instruments'
import { ARCHIVE, ARCHIVED, UNARCHIVE } from '../tune/archiveLabels'
import { keyModeLabel } from '../tune/keyMode'
import { EDIT_TUNE } from '../tune/tuneScreenCopy'
import { DELETE } from '../../ui/confirmCopy'
import { tuneTitleTransition } from '../tune/TuneHeader'
import { KeyPill } from '../../ui/KeyPill'
import { Row, type RowAction } from '../../ui/Row'
import { scansAction } from '../../ui/sharedActions'
import { StatusGlyph } from '../../ui/StatusGlyph'

// Parts that sit apart only visually run together for a screen reader, so a hidden comma
// marks each boundary.
const Pause = () => <span className="sr-only">, </span>

/**
 * What a row's name says, its parts joined by commas: the title first, so typing a title
 * still finds the row, then the key and mode in full, the status, and the secondary line.
 */
function spokenRow(title: string, keyName: string | null, status: string, detail: string[]) {
  return [title, keyName && `Key ${keyName}`, status, ...detail].filter(Boolean).join(', ')
}

/**
 * The one tune row: status glyph, title, the played instruments' tunings and "Archived" in
 * secondary, and the compact key pill trailing, so the keys form a column. The tunings line
 * leaves a standard tuning unsaid, so on touch the second line shows only what is unusual.
 */
export function TuneRow({
  entry,
  instruments,
  onEdit,
  onArchive,
  onDelete,
  onSelect,
  onViewScans,
  selecting = false,
  opening = false,
  playing = false,
}: {
  entry: CatalogEntry
  instruments: ReadonlySet<Instrument>
  /** Opens the tune's scans; present only for a tune that has any. */
  onViewScans?: () => void
  onEdit: () => void
  onArchive: (archived: boolean) => void
  onDelete: () => void
  /** Opens selection with this row selected. */
  onSelect: () => void
  /** The screen is selecting, and acts on its rows from its own bar, so the row offers nothing. */
  selecting?: boolean
  /** True for the row whose page is opening, so its title morphs into the page title. */
  opening?: boolean
  /** Marks the row of the tune the player has loaded. */
  playing?: boolean
}) {
  const archived = entry.userTune.archived_at !== null
  const actions: RowAction[] = selecting
    ? []
    : [
        ...scansAction(onViewScans),
        { id: 'edit', label: EDIT_TUNE, icon: SquarePen, onAction: onEdit },
        {
          id: 'archive',
          label: archived ? UNARCHIVE : ARCHIVE,
          icon: archived ? ArchiveRestore : Archive,
          tone: 'warning',
          onAction: () => onArchive(!archived),
        },
      ]
  // A row shows at most three actions, so Delete, the one a stray swipe should not reach,
  // waits in the menu.
  const menu: RowAction[] = selecting
    ? []
    : [
        { id: 'select', label: SELECT, icon: ListChecks, onAction: onSelect },
        ...actions,
        { id: 'delete', label: DELETE, icon: Trash2, tone: 'danger', onAction: onDelete },
      ]
  return (
    <TuneRowView
      id={entry.tune.id}
      entry={entry}
      instruments={instruments}
      actions={actions}
      menu={menu}
      opening={opening}
      playing={playing}
    />
  )
}

/**
 * The tune row's parts around the caller's own row key and actions, for a tune shown outside
 * the catalog, such as a list's row with its position leading.
 */
export function TuneRowView({
  id,
  entry,
  instruments,
  actions,
  menu,
  lead,
  note,
  notice,
  name,
  end,
  playing = false,
  opening = false,
}: {
  id: Key
  entry: CatalogEntry
  instruments: ReadonlySet<Instrument>
  actions?: RowAction[]
  /** The row menu, when it offers more than `actions`. */
  menu?: RowAction[]
  /** Sits before the status glyph, such as a list position. */
  lead?: ReactNode
  /** Secondary words before the key, such as why the row cannot be picked; the name says them. */
  note?: string
  /** A last part of the secondary line, such as why the tune cannot play. */
  notice?: string
  /** The row's accessible name, when a press on it does something the default name hides. */
  name?: string
  /** Trails the key, such as the row's own play control. */
  end?: ReactNode
  /** Marks the row of the item the player has loaded. */
  playing?: boolean
  /** True for the row whose page is opening, so its title morphs into the page title. */
  opening?: boolean
}) {
  const { tune, userTune } = entry
  const archived = userTune.archived_at !== null
  const detail = [
    playedTunings(tune.tunings, instruments),
    archived ? ARCHIVED : '',
    notice ?? '',
  ].filter(Boolean)
  const key = tune.key ? { value: tune.key, ...keyModeLabel(tune.key, tune.modes[0]) } : null
  return (
    <Row
      id={id}
      textValue={
        name ??
        spokenRow(tune.title, key?.spoken ?? null, STATUS_LABELS[effectiveStatus(userTune)], [
          ...detail,
          ...(note ? [note] : []),
        ])
      }
      leading={
        <>
          {lead}
          <StatusGlyph status={userTune.status} />
          <Pause />
        </>
      }
      title={tune.title}
      titleTransition={opening ? tuneTitleTransition(tune.id) : undefined}
      detail={
        detail.length > 0 && (
          <>
            <Pause />
            {detail.map((part, index) => (
              <span key={part}>
                {index > 0 && (
                  <>
                    <span aria-hidden> · </span>
                    <Pause />
                  </>
                )}
                {part}
              </span>
            ))}
          </>
        )
      }
      trailing={
        (key || note || end) && (
          <span className="inline-flex shrink-0 items-center gap-3">
            {note && (
              <span className="t-secondary text-ink-2 whitespace-nowrap">
                <Pause />
                {note}
              </span>
            )}
            {key && (
              <span className="inline-flex shrink-0 items-center">
                <span className="sr-only">, Key {key.spoken}</span>
                <span aria-hidden className="inline-flex">
                  <KeyPill value={key.value} suffix={key.suffix} compact />
                </span>
              </span>
            )}
            {end}
          </span>
        )
      }
      actions={actions}
      menu={menu}
      dimmed={archived}
      playing={playing}
    />
  )
}
