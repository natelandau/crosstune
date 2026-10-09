import { useState } from 'react'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { addScans, MAX_SCANS } from '../../commands/scans'
import { useDb } from '../../db/DbProvider'
import { messageFor } from '../../ui/useAction'
import { useLatest } from '../../ui/useLatest'
import { prepareImage, UndecodableImageError } from './prepareImage'
import { scansNotAddedMessage, unreadableFilesMessage } from './scanCopy'

export interface AddScans {
  /** True while picked files are being prepared and stored. */
  adding: boolean
  /** What the last add could not do, as one line; null when it did everything. */
  error: string | null
  add: (files: File[]) => Promise<void>
}

/**
 * Adds picked image files to a tune as scans, each scaled and re-encoded before it is stored.
 * `count` is how many scans the tune holds now, so a pick past the limit stops where it is full.
 */
export function useAddScans(tuneId: string, count: number): AddScans {
  const db = useDb()
  const analytics = useAnalytics()
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The count when the files land, not when the add began rendering.
  const countRef = useLatest(count)

  const add = async (files: File[]) => {
    setAdding(true)
    setError(null)
    const unreadable: string[] = []
    let room = MAX_SCANS - countRef.current
    let skipped = 0
    let failure: string | null = null
    try {
      // One at a time and in the order picked, so each scan shows as soon as it is ready and a
      // pick past the limit stops where the tune is full.
      for (const file of files) {
        if (room <= 0) {
          skipped++
          continue
        }
        let prepared
        try {
          prepared = await prepareImage(file)
        } catch (caught) {
          if (!(caught instanceof UndecodableImageError)) throw caught
          unreadable.push(file.name)
          continue
        }
        const [scanId] = await addScans(db, tuneId, [prepared])
        if (scanId) analytics.send('scan_added', { via: 'file', scan_id: scanId, tune_id: tuneId })
        room--
      }
    } catch (caught) {
      failure = messageFor(caught)
    } finally {
      const said = [
        unreadable.length > 0 ? unreadableFilesMessage(unreadable) : null,
        skipped > 0 ? scansNotAddedMessage(skipped) : null,
        failure,
      ].filter((line) => line !== null)
      setError(said.length > 0 ? said.join(' ') : null)
      setAdding(false)
    }
  }

  return { adding, error, add }
}
