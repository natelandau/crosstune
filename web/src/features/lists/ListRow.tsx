import { Play, Shuffle, SquarePen, Trash2 } from 'lucide-react'
import { editedLabel } from './editedLabel'
import { pauseListName, playListName, SHUFFLE } from './listPlayCopy'
import { RENAME } from './listsCopy'
import { NowPlayingControl } from './NowPlayingControl'
import type { ListSummary } from './useLists'
import { PLAY } from '../player/transportCopy'
import { useActiveListRun } from '../player/useListPlayback'
import { countTunes } from '../../text/format'
import { DELETE } from '../../ui/confirmCopy'
import { Row, type RowAction } from '../../ui/Row'
import { useNow } from '../../ui/useNow'

/**
 * One list among the lists: its name, then its tune count and when it was last edited. A list
 * with a tune that plays offers Play and Shuffle in its menu. Only the playing list holds a
 * trailing control.
 */
export function ListRow({
  list,
  playable,
  onPlay,
  onRename,
  onDelete,
}: {
  list: ListSummary
  /** Undefined until the lists' sources have read. */
  playable: boolean | undefined
  onPlay: (options: { shuffle?: boolean }) => void
  onRename: () => void
  onDelete: () => void
}) {
  const count = countTunes(list.count)
  const edited = editedLabel(list.lastEditedAt, new Date(useNow()))
  const run = useActiveListRun(list.id)
  const actions: RowAction[] = [
    { id: 'rename', label: RENAME, icon: SquarePen, onAction: onRename },
    { id: 'delete', label: DELETE, icon: Trash2, tone: 'danger', onAction: onDelete },
  ]
  const plays: RowAction[] = playable
    ? [
        { id: 'play', label: PLAY, icon: Play, onAction: () => onPlay({ shuffle: false }) },
        { id: 'shuffle', label: SHUFFLE, icon: Shuffle, onAction: () => onPlay({ shuffle: true }) },
      ]
    : []
  return (
    <Row
      id={list.id}
      textValue={`${list.name}, ${count}, ${edited}`}
      title={list.name}
      stacked
      playing={run !== null}
      detail={
        <>
          <span className="sr-only">, </span>
          <span className="t-num">{count}</span>
          <span aria-hidden> · </span>
          <span className="sr-only">, </span>
          {edited}
        </>
      }
      trailing={
        run ? (
          <NowPlayingControl
            pauseName={pauseListName(list.name)}
            playName={playListName(list.name)}
            settled={run.settled}
          />
        ) : undefined
      }
      actions={actions}
      menu={[...plays, ...actions]}
    />
  )
}
