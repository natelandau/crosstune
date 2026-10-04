/** What the activity logs share: timing audible stretches and noticing the page leave. */

export function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** Wall-clock time while something plays, on a clock the caller reads. */
export class AudibleSpan {
  /** When it first started playing, or null if it never has. */
  startedAt: number | null = null
  #since: number | null = null

  /** Starts timing at `t`; does nothing while already timing. */
  start(t: number): void {
    if (this.#since !== null) return
    this.#since = t
    this.startedAt ??= t
  }

  /** The time since the last start or take, timing on from `t`; 0 while stopped. */
  take(t: number): number {
    if (this.#since === null) return 0
    const ms = t - this.#since
    this.#since = t
    return ms
  }

  /** The time since the last start or take, and stops timing. */
  stop(t: number): number {
    const ms = this.take(t)
    this.#since = null
    return ms
  }
}

/**
 * Calls `fn` when the page is being unloaded or put in the back-forward cache (`pagehide`), or
 * hidden behind another tab or app (`hidden`). Returns the unsubscribe.
 */
export function onPageLeave(fn: (how: 'pagehide' | 'hidden') => void): () => void {
  const onPageHide = () => fn('pagehide')
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') fn('hidden')
  }
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    window.removeEventListener('pagehide', onPageHide)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
