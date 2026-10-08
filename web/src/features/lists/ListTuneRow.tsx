import { ListChecks, ListX, SquarePen, Volume2 } from 'lucide-react'
import type { Instrument, PlayFirst } from '../../api/vocabulary'
import { NOT_PLAYABLE, REMOVE } from './listsCopy'
import { useListRowSource } from './useListRowSource'
import type { ListItemView } from './useLists'
import { usePlayingTune } from '../player/usePlayingTune'
import { SELECT } from '../selection/selectionCopy'
import { EDIT_TUNE } from '../tune/tuneScreenCopy'
import type { MenuItem } from '../../ui/menuTypes'
import { TuneRowView } from '../catalog/TuneRow'
import type { RowAction } from '../../ui/Row'
import { moveActions, scansAction } from '../../ui/sharedActions'
import { ListRowPlay } from './ListRowPlay'

/**
 * A tune in a list: its position leading, then the tune row's parts, then its own play
 * control. Scans, for a tune that has any, Edit, and Remove are its actions, and its menu adds
 * the moves before Remove, so Remove stays last. While the player holds a recording or link of
 * the tune, an animated speaker takes the position's place and the row takes a light wash.
 */
export function ListTuneRow({
  view,
  position,
  positionWidth,
  instruments,
  playFirst,
  moves,
  onEdit,
  onRemove,
  onSelect,
  onViewScans,
  selecting = false,
  opening,
}: {
  view: ListItemView
  /** Counted from 1. */
  position: number
  /** Holds the widest position the list shows, so every title starts on one line. */
  positionWidth: string
  instruments: ReadonlySet<Instrument>
  /** The user's play-first choice, undefined until the settings row has been read. */
  playFirst: PlayFirst | undefined
  moves: MenuItem[]
  onEdit: () => void
  onRemove: () => void
  /** Opens selection with this row selected. */
  onSelect: () => void
  /** Opens the tune's scans; present only for a tune that has any. */
  onViewScans?: () => void
  /** The list is selecting, and acts on its rows from its own bar, so the row offers nothing. */
  selecting?: boolean
  opening?: boolean
}) {
  const source = useListRowSource(view, playFirst)
  // Any recording or link of the tune, as on the catalog's rows, so the two screens agree.
  const playing = usePlayingTune() === view.tune.id
  const edit: RowAction = { id: 'edit', label: EDIT_TUNE, icon: SquarePen, onAction: onEdit }
  const remove: RowAction = {
    id: 'remove',
    label: REMOVE,
    icon: ListX,
    tone: 'danger',
    onAction: onRemove,
  }
  const scans = scansAction(onViewScans)
  const menu: RowAction[] = [
    { id: 'select', label: SELECT, icon: ListChecks, onAction: onSelect },
    ...scans,
    edit,
    ...moveActions(moves),
    remove,
  ]
  return (
    <TuneRowView
      id={view.item.id}
      entry={view}
      instruments={instruments}
      actions={selecting ? [] : [...scans, edit, remove]}
      menu={selecting ? [] : menu}
      opening={opening}
      playing={playing}
      notice={source === null ? NOT_PLAYABLE : undefined}
      end={
        <ListRowPlay
          source={source}
          title={view.tune.title}
          listId={view.item.list_id}
          tuneId={view.tune.id}
        />
      }
      lead={
        <>
          <span
            data-position
            className="t-secondary t-num text-ink-2 inline-flex shrink-0 justify-end"
            style={{ minWidth: positionWidth }}
          >
            {playing ? (
              <>
                <Volume2
                  data-playing-glyph
                  className="text-slate size-4 motion-safe:animate-pulse"
                  aria-hidden
                />
                <span className="sr-only">{position}</span>
              </>
            ) : (
              position
            )}
          </span>
          <span className="sr-only">, </span>
        </>
      }
    />
  )
}
