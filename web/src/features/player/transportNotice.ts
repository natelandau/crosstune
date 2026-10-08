import { PLAY_FAILED } from './playerCopy'
import type { RecordingTransport } from './useRecordingTransport'

/** Why the recording cannot play, which stands in for its time; null while it can. */
export function transportNotice(transport: RecordingTransport): string | null {
  return transport.status ?? (transport.state.failed ? PLAY_FAILED : null)
}
