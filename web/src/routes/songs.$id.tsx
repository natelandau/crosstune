import { createFileRoute } from '@tanstack/react-router'
import { validateEditSearch } from '../editMode'
import { SongPage } from '../features/song/SongPage'

export const Route = createFileRoute('/songs/$id')({
  validateSearch: validateEditSearch,
  component: SongPage,
})
