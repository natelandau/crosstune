import { createFileRoute } from '@tanstack/react-router'
import { ListsScreen } from '../features/lists/ListsScreen'

export const Route = createFileRoute('/lists/')({
  component: ListsScreen,
})
