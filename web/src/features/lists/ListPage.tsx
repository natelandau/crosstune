import { useNavigate } from '@tanstack/react-router'
import { useEditMode, useSelectMode } from '../../editMode'
import { ListDetail } from './ListDetail'

export function ListPage() {
  const { id, edit, setEdit } = useEditMode('/lists/$id')
  const { select, setSelect } = useSelectMode()
  const navigate = useNavigate()
  return (
    <ListDetail
      listId={id}
      edit={edit}
      onEditChange={setEdit}
      selecting={select && !edit}
      onSelectingChange={setSelect}
      onDeleted={() => void navigate({ to: '/lists', replace: true })}
    />
  )
}
