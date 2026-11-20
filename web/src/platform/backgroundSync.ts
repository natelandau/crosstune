import * as Sentry from '@sentry/react'
import { UPLOAD_SYNC_TAG } from '../db/recordings'

/** The largest recording file the page hands to the service worker to upload. */
export const BACKGROUND_UPLOAD_MAX_BYTES = 20_000_000

export interface BackgroundUploads {
  /** True when this browser has Background Sync and a service worker. */
  available(): boolean
  /** Ask the worker to run its upload hand-offs. False when the browser refused, as when the
   * Background Sync permission is blocked: no hand-off would ever run. */
  request(): Promise<boolean>
}

// The DOM library has no types for Background Sync.
type SyncRegistration = ServiceWorkerRegistration & {
  sync: { register(tag: string): Promise<void> }
}

export function browserBackgroundUploads(): BackgroundUploads {
  // A refusal holds for the page's life, so every later upload stays on the page.
  let refused = false
  // Calls while one registration is in flight share it instead of registering again.
  let pending: Promise<boolean> | null = null
  const register = async (): Promise<boolean> => {
    try {
      const registration = (await navigator.serviceWorker.ready) as SyncRegistration
      await registration.sync.register(UPLOAD_SYNC_TAG)
      return true
    } catch (error) {
      refused = true
      Sentry.captureException(error)
      return false
    }
  }
  return {
    available: () =>
      !refused &&
      'serviceWorker' in navigator &&
      // With no worker in control, as in development or before the first install, `ready`
      // never resolves and a hand-off would wait for its slot to expire.
      navigator.serviceWorker.controller !== null &&
      typeof ServiceWorkerRegistration !== 'undefined' &&
      'sync' in ServiceWorkerRegistration.prototype,
    request() {
      pending ??= register().finally(() => {
        pending = null
      })
      return pending
    },
  }
}
