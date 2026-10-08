import { containsText } from '../../text/fold'
import type { RecordingView } from './useRecordings'

/** A recording's own label, trimmed; empty when it has none. */
export function recordingLabel(view: RecordingView): string {
  return view.recording.label?.trim() ?? ''
}

/** Whether a search finds a recording: by its own label or its tune's title. */
export function recordingMatches(view: RecordingView, query: string): boolean {
  const needle = query.trim()
  return containsText(recordingLabel(view), needle) || containsText(view.tuneTitle ?? '', needle)
}
