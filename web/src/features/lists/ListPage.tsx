import { useNavigate } from '@tanstack/react-router'
import { useEditMode } from '../../editMode'
import { ListDetail } from './ListDetail'

export function ListPage() {
  const { id, edit, setEdit } = useEditMode('/lists/$id')
  const navigate = useNavigate()
  return (
    <ListDetail
      listId={id}
      edit={edit}
      onEditChange={setEdit}
      onDeleted={() => void navigate({ to: '/lists', replace: true })}
    />
  )
}
