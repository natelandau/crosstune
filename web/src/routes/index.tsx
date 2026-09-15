import { createFileRoute } from '@tanstack/react-router'
import { validateSelectSearch } from '../editMode'
import { CatalogScreen } from '../features/catalog/CatalogScreen'

export const Route = createFileRoute('/')({
  validateSearch: validateSelectSearch,
  component: CatalogScreen,
})
