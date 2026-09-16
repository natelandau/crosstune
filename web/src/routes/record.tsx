import { createFileRoute } from '@tanstack/react-router'
import { RecordingScreen } from '../features/recording/RecordingScreen'

export const Route = createFileRoute('/record')({
  validateSearch: (search: Record<string, unknown>): { song?: string } =>
    typeof search.song === 'string' && search.song ? { song: search.song } : {},
  component: RecordingScreen,
})
