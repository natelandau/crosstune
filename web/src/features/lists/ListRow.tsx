import { SquarePen, Trash2 } from 'lucide-react'
import { editedLabel } from './editedLabel'
import { RENAME } from './listsCopy'
import type { ListSummary } from './useLists'
import { countTunes } from '../selection/copy'
import { DELETE } from '../../ui/confirmCopy'
import { Row, type RowAction } from '../../ui/Row'
import { useNow } from '../../ui/useNow'

/** One list among the lists: its name, then its tune count and when it was last edited. */
export function ListRow({
  list,
  onRename,
  onDelete,
}: {
  list: ListSummary
  onRename: () => void
  onDelete: () => void
}) {
  const count = countTunes(list.count)
  const edited = editedLabel(list.lastEditedAt, new Date(useNow()))
  const actions: RowAction[] = [
    { id: 'rename', label: RENAME, icon: SquarePen, onAction: onRename },
    { id: 'delete', label: DELETE, icon: Trash2, tone: 'danger', onAction: onDelete },
  ]
  return (
    <Row
      id={list.id}
      textValue={`${list.name}, ${count}, ${edited}`}
      title={list.name}
      stacked
      detail={
        <>
          <span className="sr-only">, </span>
          <span className="t-num">{count}</span>
          <span aria-hidden> · </span>
          <span className="sr-only">, </span>
          {edited}
        </>
      }
      actions={actions}
    />
  )
}
