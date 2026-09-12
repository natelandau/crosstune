import { useNavigate, useParams } from '@tanstack/react-router'
import { ListDetail } from './ListDetail'

export function ListPage() {
  const { id } = useParams({ from: '/lists/$id' })
  const navigate = useNavigate()
  return <ListDetail listId={id} onDeleted={() => void navigate({ to: '/lists', replace: true })} />
}
