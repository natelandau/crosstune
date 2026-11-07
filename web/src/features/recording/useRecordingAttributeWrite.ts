import { useCallback, useState } from 'react'
import type { RecordingRow } from '../../api/types'
import { RECORDING_NOT_FOUND } from '../../commands/messages'
import { updateRecording } from '../../commands/recordings'
import { useDb } from '../../db/DbProvider'
import type { LocalRecording } from '../../db/types'
import { messageFor } from '../../ui/useAction'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { AnalyticsClient } from '../../usage/client'
import { recordingOrigin } from '../../usage/origin'
import { reportRecordingFiled } from '../recordings/reportRecordingFiled'

/** The fields a recording's row editors write. */
export type RecordingPatch = Partial<
  Pick<
    RecordingRow,
    'label' | 'tune_id' | 'players' | 'notes' | 'recorded_at' | 'recorded_precision'
  >
>

export interface RecordingAttributeWrite {
  /** Writes the patch to the recording the hook was opened for. */
  write: (patch: RecordingPatch) => Promise<void>
  /** Runs a write of the recording's own, such as its place, reporting a refusal as `write` does. */
  run: (save: () => Promise<unknown>) => Promise<void>
  /** The last write's refusal. */
  error: string | null
}

/** Reports what a written patch changed: a rename, a filing, or an unfiling. */
function reportPatch(analytics: AnalyticsClient, before: LocalRecording, patch: RecordingPatch) {
  const props = { origin: recordingOrigin(before), recording_id: before.id }
  if (patch.label !== undefined && patch.label !== (before.label ?? null)) {
    analytics.send('recording_renamed', props)
  }
  if (patch.tune_id === undefined) return
  if (patch.tune_id) reportRecordingFiled(analytics, before, patch.tune_id)
  else if (before.tune_id) analytics.send('recording_unfiled', props)
}

/** Writes one recording's fields from its row editors, under the same rules as every edit. */
export function useRecordingAttributeWrite(recordingId: string): RecordingAttributeWrite {
  const db = useDb()
  const analytics = useAnalytics()
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (save: () => Promise<unknown>) => {
    setError(null)
    try {
      await save()
    } catch (caught) {
      setError(messageFor(caught))
    }
  }, [])

  const write = useCallback(
    (patch: RecordingPatch) =>
      run(async () => {
        // Read first, since the reports classify by the row the write replaces.
        const before = await db.recordings.get(recordingId)
        if (!before || before.deleted_at) throw new Error(RECORDING_NOT_FOUND)
        await updateRecording(db, recordingId, patch)
        reportPatch(analytics, before, patch)
      }),
    [db, analytics, recordingId, run],
  )

  return { write, run, error }
}
