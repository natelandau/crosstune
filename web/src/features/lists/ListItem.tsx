import { IonLabel } from '@ionic/react'
import { Row, type RowAction } from '../../ui/Row'
import { editedLabel } from './editedLabel'
import type { ListSummary } from './useLists'

/** The one list row, wherever lists are listed. */
export function ListItem({
  list,
  onOpen,
  actions,
}: {
  list: ListSummary
  onOpen?: () => void
  actions?: readonly RowAction[]
}) {
  return (
    <Row name={list.name} onOpen={onOpen} actions={actions}>
      <IonLabel className="my-2.5">
        <h2 className="type-headline truncate">{list.name}</h2>
        <p className="type-subheadline">
          <span className="tabular-nums">
            {list.count} {list.count === 1 ? 'tune' : 'tunes'}
          </span>
          {' · '}
          {editedLabel(list.lastEditedAt)}
        </p>
      </IonLabel>
    </Row>
  )
}
