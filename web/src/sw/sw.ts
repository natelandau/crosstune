/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { UPLOAD_SYNC_TAG } from '../db/recordings'
import { APP_SHELL, NAVIGATION_DENYLIST } from './navigation'
import { runUploadHandoffs, userDatabaseNames } from './uploadHandoffs'

declare const self: ServiceWorkerGlobalScope

// Background Sync is not in TypeScript's WebWorker lib.
interface SyncEvent extends ExtendableEvent {
  readonly tag: string
}

// autoUpdate: a new worker replaces the old one without waiting for tabs to close.
void self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

registerRoute(
  new NavigationRoute(createHandlerBoundToURL(APP_SHELL), { denylist: NAVIGATION_DENYLIST }),
)

self.addEventListener('sync', (event) => {
  const sync = event as SyncEvent
  if (sync.tag !== UPLOAD_SYNC_TAG) return
  sync.waitUntil(
    runUploadHandoffs({
      // Called as deps.fetch, a bare fetch would throw "Illegal invocation".
      fetch: (input, init) => fetch(input, init),
      now: Date.now,
      databaseNames: () => userDatabaseNames(indexedDB),
    }),
  )
})
