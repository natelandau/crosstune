import { isComplete } from '../../../db/recordings'
import type { RecordingView } from '../useRecordings'

export type ExportBlock = 'capturing' | 'not_ready' | 'offline'

export type ExportReadiness =
  { kind: 'local'; blob: Blob } | { kind: 'fetch' } | { kind: 'blocked'; reason: ExportBlock }

/**
 * How a recording's audio reaches an export: from this device, from the server, or not at all.
 * The server serves only a ready recording, and fetching needs a connection.
 */
export function exportReadiness(view: RecordingView, online: boolean): ExportReadiness {
  const { file, recording } = view
  if (file?.local_state === 'capturing') return { kind: 'blocked', reason: 'capturing' }
  if (file && isComplete(file)) return { kind: 'local', blob: file.blob }
  if (recording.state !== 'ready') return { kind: 'blocked', reason: 'not_ready' }
  return online ? { kind: 'fetch' } : { kind: 'blocked', reason: 'offline' }
}
