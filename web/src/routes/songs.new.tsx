import { createFileRoute } from '@tanstack/react-router'
import { NewSongScreen } from '../features/song/NewSongScreen'
import { parseNewSongSearch } from '../features/song/newSongSearch'

export const Route = createFileRoute('/songs/new')({
  validateSearch: parseNewSongSearch,
  component: NewSongScreen,
})
