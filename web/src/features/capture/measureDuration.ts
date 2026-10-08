/** How long to wait for the metadata before giving up on a file the browser cannot read. */
export const MEASURE_TIMEOUT_MS = 10_000

/**
 * The length of an audio file in whole milliseconds, or null when the browser cannot tell.
 *
 * Reads only the container's metadata through an audio element. Decoding the file instead
 * would hold the whole recording as PCM, which an hour-long take cannot afford on a phone.
 * A stream whose header carries no length, such as a WebM written without cues, reports an
 * infinite duration and so measures as null.
 */
export function measureDuration(
  blob: Blob,
  createAudio: () => HTMLAudioElement = () => document.createElement('audio'),
): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = createAudio()
    const url = URL.createObjectURL(blob)
    let settled = false
    const finish = (ms: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      audio.removeEventListener('loadedmetadata', onMetadata)
      audio.removeEventListener('error', onError)
      audio.removeAttribute('src')
      URL.revokeObjectURL(url)
      resolve(ms)
    }
    const onMetadata = () => {
      const seconds = audio.duration
      finish(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null)
    }
    const onError = () => finish(null)
    const timer = setTimeout(() => finish(null), MEASURE_TIMEOUT_MS)
    audio.addEventListener('loadedmetadata', onMetadata)
    audio.addEventListener('error', onError)
    audio.preload = 'metadata'
    audio.src = url
  })
}
