import { createFileRoute } from '@tanstack/react-router'
import { CatalogScreen } from '../features/catalog/CatalogScreen'

export const Route = createFileRoute('/')({
  component: CatalogScreen,
})
