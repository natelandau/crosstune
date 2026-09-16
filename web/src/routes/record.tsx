import { createFileRoute } from '@tanstack/react-router'
import { RecordingScreen } from '../features/recording/RecordingScreen'

export const Route = createFileRoute('/record')({
  component: RecordingScreen,
})
