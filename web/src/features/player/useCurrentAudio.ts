import { useEffect } from 'react'
import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import { isStale } from '../../sync/transfers'

/**
 * Fetches the current revision of a recording's audio when the blob this device holds is
 * from an older one, as after a trim made elsewhere. The held blob keeps playing until the
 * new one is stored, which then replaces it in place. A recording still being read (null)
 * fetches nothing.
 */
export function useCurrentAudio(
  recording: LocalRecording | null,
  file: RecordingFile | null | undefined,
) {
  const syncEngine = useSyncEngine()
  const online = useOnline()
  const stale =
    !!recording && !!file?.blob && recording.state === 'ready' && isStale(recording, file)
  const id = recording?.id
  const rev = recording?.playback_rev
  useEffect(() => {
    if (!stale || !online || !id) return
    // The sync engine shares one fetch per recording, so the dock and practice
    // asking together download it once.
    void syncEngine.download(id)
  }, [stale, online, syncEngine, id, rev])
}
