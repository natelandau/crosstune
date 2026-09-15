import { createFileRoute } from '@tanstack/react-router'
import { RecordingsScreen } from '../features/recordings/RecordingsScreen'

export const Route = createFileRoute('/recordings')({ component: RecordingsScreen })
