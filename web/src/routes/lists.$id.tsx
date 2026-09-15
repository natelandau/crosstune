import { createFileRoute } from '@tanstack/react-router'
import { validateEditSearch, validateSelectSearch } from '../editMode'
import { ListPage } from '../features/lists/ListPage'

export const Route = createFileRoute('/lists/$id')({
  validateSearch: (search: Record<string, unknown>) => ({
    ...validateEditSearch(search),
    ...validateSelectSearch(search),
  }),
  component: ListPage,
})
