/**
 * Keep the screen on until released. The browser drops the lock whenever the page is hidden,
 * so it is requested again on every return to visibility, and also if the browser releases
 * the lock on its own (for example entering low-power mode) while still visible.
 */
export function holdWakeLock({
  doc = document,
  nav = navigator,
}: { doc?: Document; nav?: Navigator } = {}): () => void {
  const wakeLock = nav.wakeLock
  if (!wakeLock) return () => {}
  let sentinel: WakeLockSentinel | null = null
  let released = false
  let acquiring = false

  function onSentinelRelease() {
    if (!released && doc.visibilityState === 'visible') void acquire()
  }

  async function acquire() {
    // Guards re-entry: a visibilitychange and a sentinel 'release' can both fire for the
    // same drop, and must not start two concurrent requests.
    if (released || acquiring || doc.visibilityState === 'hidden') return
    acquiring = true
    try {
      const next = await wakeLock.request('screen')
      if (released) {
        // The hold was released while the request was in flight; nothing should keep it.
        void next.release().catch(() => {})
        return
      }
      sentinel = next
      sentinel.addEventListener('release', onSentinelRelease)
    } catch {
      sentinel = null
    } finally {
      acquiring = false
    }
  }
  const onVisibility = () => {
    if (doc.visibilityState === 'visible' && (sentinel === null || sentinel.released))
      void acquire()
  }
  doc.addEventListener('visibilitychange', onVisibility)
  void acquire()

  return () => {
    released = true
    doc.removeEventListener('visibilitychange', onVisibility)
    void sentinel?.release().catch(() => {})
    sentinel = null
  }
}
