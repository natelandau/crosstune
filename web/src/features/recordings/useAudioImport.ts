import { useCallback } from 'react'
import { useDb } from '../../db/DbProvider'
import { messageFor } from '../../ui/useAction'
import { useLatest } from '../../ui/useLatest'
import { addAudioFiles } from './addAudioFiles'

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
  const onErrorRef = useLatest(onError)
  return useCallback(
    async (files: File[]) => {
      onErrorRef.current(null)
      try {
        await addAudioFiles(db, files, tuneId)
      } catch (caught) {
        onErrorRef.current(messageFor(caught))
      }
    },
    [db, tuneId, onErrorRef],
  )
}
