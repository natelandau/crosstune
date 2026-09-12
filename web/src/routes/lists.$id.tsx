import { createFileRoute } from '@tanstack/react-router'
import { ListPage } from '../features/lists/ListPage'

export const Route = createFileRoute('/lists/$id')({
  component: ListPage,
})
