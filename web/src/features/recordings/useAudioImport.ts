import { useCallback } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import { countBucket } from '../../usage/buckets'
import type { AudioFormat } from '../../usage/events'
import { useDb } from '../../db/DbProvider'
import { messageFor } from '../../ui/useAction'
import { useLatest } from '../../ui/useLatest'
import { addAudioFiles, audioFormatOf } from './addAudioFiles'

/**
 * Adds audio files already on the device as recordings, filed under `tuneId` or unfiled. Each
 * import first clears the last refusal with null, then reports its own; the promise never
 * rejects.
 */
export function useAudioImport(
  tuneId: string | null,
  onError: (message: string | null) => void,
): (files: File[]) => Promise<void> {
  const db = useDb()
  const analytics = useAnalytics()
  const onErrorRef = useLatest(onError)
  return useCallback(
    async (files: File[]) => {
      onErrorRef.current(null)
      const added = new Map<AudioFormat, number>()
      try {
        await addAudioFiles(db, files, tuneId, (file) => {
          const format = audioFormatOf(file)
          added.set(format, (added.get(format) ?? 0) + 1)
        })
      } catch (caught) {
        onErrorRef.current(messageFor(caught))
      }
      // One report per format, for the files that landed, even when others in the batch were refused.
      for (const [format, count] of added) {
        analytics.send('audio_imported', { count_bucket: countBucket(count), format })
      }
    },
    [analytics, db, tuneId, onErrorRef],
  )
}
