import { createFileRoute } from '@tanstack/react-router'
import { validateEditSearch } from '../editMode'
import { ListPage } from '../features/lists/ListPage'

export const Route = createFileRoute('/lists/$id')({
  validateSearch: validateEditSearch,
  component: ListPage,
})
