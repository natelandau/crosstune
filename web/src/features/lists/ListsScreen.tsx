import { ListMusic, Plus } from 'lucide-react'
import { useNavigate } from 'react-router'
import { ADD_LIST, NO_LISTS_HINT, NO_LISTS_TITLE } from './listsCopy'
import { useListsScreen } from './useListsScreen'
import { destination } from '../../app/destinations'
import { ColumnTitle } from '../../app/ColumnTitle'
import { PaneBar } from '../../app/PaneBar'
import { Button } from '../../ui/Button'
import { useConfirm } from '../../ui/Confirm'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorLine } from '../../ui/ErrorLine'
import { RowList } from '../../ui/RowList'
import { ListNameSheet } from './ListNameSheet'
import { useListNameLauncher } from './listNameLauncher'
import { ListRow } from './ListRow'

const LISTS = destination('lists')

/** Every list, each opening in the content column, with Add for a new one. */
export function ListsScreen() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { lists, error, naming, setNaming, remove } = useListsScreen({ confirm })
  const add = useListNameLauncher().open

  return (
    <>
      <PaneBar
        title={LISTS.label}
        trailing={<Button icon={Plus} label={ADD_LIST} iconOnly onPress={add} />}
      />
      <ColumnTitle title={LISTS.label} />
      <ErrorLine error={error} place="bar" />
      {lists &&
        (lists.length === 0 ? (
          <EmptyState
            icon={ListMusic}
            title={NO_LISTS_TITLE}
            hint={NO_LISTS_HINT}
            action={<Button variant="primary" label={ADD_LIST} onPress={add} />}
          />
        ) : (
          <RowList
            label={LISTS.label}
            onAction={(key) => void navigate(`${LISTS.root}/${String(key)}`)}
          >
            {lists.map((list) => (
              <ListRow
                key={list.id}
                list={list}
                onRename={() => setNaming({ kind: 'rename', listId: list.id, name: list.name })}
                onDelete={() => void remove(list)}
              />
            ))}
          </RowList>
        ))}
      <ListNameSheet target={naming} onClose={() => setNaming(null)} />
    </>
  )
}
