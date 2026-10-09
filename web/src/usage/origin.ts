import type { RecordingSource } from '../api/vocabulary'
import type { Origin } from './events'

const ORIGIN: Record<RecordingSource, Origin> = {
  microphone: 'recorded',
  upload: 'imported',
  import: 'slippery_hill',
}

/** The plan's origin for a recording, from how it came to exist. */
export function originOf(source: RecordingSource): Origin {
  return ORIGIN[source]
}

/** `originOf` for a stored row, whose `source` is typed as a plain string. */
export function recordingOrigin(recording: { source: string }): Origin {
  const { source } = recording
  return Object.hasOwn(ORIGIN, source) ? ORIGIN[source as RecordingSource] : 'imported'
}
