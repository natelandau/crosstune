import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

function loadWorker() {
  const listeners: Record<string, (event: { waitUntil: (p: Promise<unknown>) => void }) => void> =
    {}
  const client = { url: 'https://crosstune.app/tunes', navigate: vi.fn() }
  const self = {
    registration: { unregister: vi.fn().mockResolvedValue(true) },
    clients: { matchAll: vi.fn().mockResolvedValue([client]) },
    addEventListener: (type: string, fn: (typeof listeners)[string]) => {
      listeners[type] = fn
    },
  }
  const caches = {
    keys: vi.fn().mockResolvedValue(['a', 'b']),
    delete: vi.fn().mockResolvedValue(true),
  }
  const source = readFileSync(resolve(import.meta.dirname, '../public/sw.js'), 'utf8')
  runInNewContext(source, { self, caches, URL })
  return { listeners, self, caches, client }
}

describe('retired service worker', () => {
  it('skips waiting on install so it activates beside open windows', () => {
    const { listeners, self } = loadWorker()
    const skipWaiting = vi.fn()
    Object.assign(self, { skipWaiting })
    listeners.install?.({ waitUntil: () => {} })
    expect(skipWaiting).toHaveBeenCalled()
  })

  it('unregisters, clears caches, and sends window clients to the site root on activate', async () => {
    const { listeners, self, caches, client } = loadWorker()
    let pending: Promise<unknown> = Promise.resolve()
    listeners.activate?.({ waitUntil: (p) => (pending = p) })
    await pending
    expect(self.registration.unregister).toHaveBeenCalled()
    expect(caches.delete).toHaveBeenCalledWith('a')
    expect(caches.delete).toHaveBeenCalledWith('b')
    expect(self.clients.matchAll).toHaveBeenCalledWith({ type: 'window' })
    expect(client.navigate).toHaveBeenCalledWith('https://crosstune.app/')
  })

  it('survives a failed navigation', async () => {
    const { listeners, client } = loadWorker()
    client.navigate.mockRejectedValue(new Error('blocked'))
    let pending: Promise<unknown> = Promise.resolve()
    listeners.activate?.({ waitUntil: (p) => (pending = p) })
    await expect(pending).resolves.toBeUndefined()
    expect(client.navigate).toHaveBeenCalledTimes(1)
  })

  it('registers no fetch listener', () => {
    const { listeners } = loadWorker()
    expect(listeners.fetch).toBeUndefined()
  })
})
