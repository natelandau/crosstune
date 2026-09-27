import { useEffect } from 'react'
import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import { isStale } from '../../sync/transfers'

/**
 * Fetches the current revision of a recording's audio when the blob this device holds is
 * from an older one, as after a trim made elsewhere. The held blob keeps playing until the
 * new one is stored, which then replaces it in place.
 */
export function useCurrentAudio(recording: LocalRecording, file: RecordingFile | null | undefined) {
  const syncEngine = useSyncEngine()
  const online = useOnline()
  const stale = !!file?.blob && recording.state === 'ready' && isStale(recording, file)
  const rev = recording.playback_rev
  useEffect(() => {
    if (!stale || !online) return
    // The sync engine shares one fetch per recording, so the dock and the recording screen
    // asking together download it once.
    void syncEngine.download(recording.id)
  }, [stale, online, syncEngine, recording.id, rev])
}
