import { useState } from 'react'
import { useSyncEngine } from '../../sync/SyncProvider'

/**
 * A tap's download of one recording. It is tracked here because a recording with no file row yet
 * has nowhere durable to carry that state, and telling a failure from idle is what lets a failed
 * download say so, the way a stuck upload does.
 */
export function useDownload(recordingId: string): {
  fetch: 'idle' | 'fetching' | 'failed'
  download: () => void
} {
  const engine = useSyncEngine()
  const [fetch, setFetch] = useState<'idle' | 'fetching' | 'failed'>('idle')
  const download = () => {
    setFetch('fetching')
    void engine.download(recordingId).then((blob) => setFetch(blob ? 'idle' : 'failed'))
  }
  return { fetch, download }
}
