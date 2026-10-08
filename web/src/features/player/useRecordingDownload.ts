import { useEffect, useState } from 'react'
import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'

export interface RecordingDownload {
  /** The audio to play: this device's copy, or what a download just returned. */
  blob: Blob | null
  /** A download for this recording settled without audio. */
  failed: boolean
  retry: () => void
}

/**
 * Fetch a ready recording's audio when this device holds none. Asking the sync engine joins
 * any download another surface already started, so two never fetch the same file twice. A
 * failure is tried again when the device comes back online, or on `retry`. A recording still
 * being read (null) fetches nothing.
 */
export function useRecordingDownload(
  recording: LocalRecording | null,
  file: RecordingFile | null | undefined,
): RecordingDownload {
  const syncEngine = useSyncEngine()
  const online = useOnline()
  const [attempt, setAttempt] = useState(0)
  const [wasOnline, setWasOnline] = useState(online)
  if (online !== wasOnline) {
    setWasOnline(online)
    if (online) setAttempt((n) => n + 1)
  }
  // A result answers only the attempt that asked, so a new attempt shows as downloading.
  const id = recording?.id ?? null
  const request = `${id}:${attempt}`
  const [fetched, setFetched] = useState<{ request: string; blob: Blob | null } | null>(null)
  const settled = fetched?.request === request ? fetched : null
  const blob = file?.blob ?? settled?.blob ?? null
  const needed = !blob && recording?.state === 'ready'

  useEffect(() => {
    if (!needed || !online || !id) return
    let cancelled = false
    void syncEngine.download(id).then((result) => {
      if (!cancelled) setFetched({ request, blob: result })
    })
    return () => {
      cancelled = true
    }
  }, [needed, online, syncEngine, id, request])

  return {
    blob,
    failed: needed && settled !== null,
    retry: () => setAttempt((n) => n + 1),
  }
}
