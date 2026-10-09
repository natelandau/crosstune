import type { AnalyticsClient } from '../../analytics/client'
import { recordingOrigin } from '../../analytics/origin'
import type { LocalRecording } from '../../db/types'

/**
 * Reports a recording filed under `tuneId`. `before` is the row as it stood before the write:
 * the stored tune decides `from`, since deleting a tune leaves its recordings pointing at it.
 */
export function reportRecordingFiled(
  analytics: AnalyticsClient,
  before: Pick<LocalRecording, 'id' | 'tune_id' | 'source'>,
  tuneId: string,
): void {
  // Filing under the tune it is already under changes nothing.
  if (before.tune_id === tuneId) return
  analytics.send('recording_filed', {
    from: before.tune_id ? 'other_tune' : 'unfiled',
    origin: recordingOrigin(before),
    recording_id: before.id,
    tune_id: tuneId,
  })
}
