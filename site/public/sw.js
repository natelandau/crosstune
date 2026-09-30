// Retires the service worker the web app once served from this origin. An installed copy
// finds this file on its next update check, activates at once, unregisters itself, drops
// every cache, and sends its open windows to the site root. It registers no fetch handler.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister()
      for (const key of await caches.keys()) {
        await caches.delete(key)
      }
      const clients = await self.clients.matchAll({ type: 'window' })
      await Promise.allSettled(
        clients.map((client) => client.navigate(new URL('/', client.url).href)),
      )
    })(),
  )
})
