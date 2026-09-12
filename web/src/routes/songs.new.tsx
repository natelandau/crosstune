import { createFileRoute } from '@tanstack/react-router'
import { NewSongScreen } from '../features/song/NewSongScreen'

export const Route = createFileRoute('/songs/new')({
  component: NewSongScreen,
})
