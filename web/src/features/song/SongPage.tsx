import { useNavigate } from '@tanstack/react-router'
import { useEditMode } from '../../editMode'
import { SongDetail } from './SongDetail'

export function SongPage() {
  const { id, edit, setEdit } = useEditMode('/songs/$id')
  const navigate = useNavigate()
  return (
    <SongDetail
      songId={id}
      edit={edit}
      onEditChange={setEdit}
      onDeleted={() => void navigate({ to: '/', replace: true })}
    />
  )
}
