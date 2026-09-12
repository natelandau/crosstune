import { createFileRoute } from '@tanstack/react-router'
import { SongPage } from '../features/song/SongPage'

export const Route = createFileRoute('/songs/$id')({
  validateSearch: (search: Record<string, unknown>): { edit?: boolean } =>
    search.edit === true || search.edit === 'true' ? { edit: true } : {},
  component: SongPage,
})
