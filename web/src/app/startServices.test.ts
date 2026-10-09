import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const registerSW = vi.fn()
const init = vi.fn()
const startAnalytics = vi.fn()
vi.mock('virtual:pwa-register', () => ({ registerSW }))
vi.mock('@sentry/react', () => ({ init }))
vi.mock('../analytics/client', () => ({ startAnalytics }))

beforeEach(() => {
  registerSW.mockReset()
  init.mockReset()
  startAnalytics.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

it('registers the service worker at once and starts error reporting when a DSN is set', async () => {
  vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o1.ingest.sentry.io/1')
  const { startServices } = await import('./startServices')
  startServices()
  expect(registerSW).toHaveBeenCalledWith({ immediate: true })
  expect(init).toHaveBeenCalledOnce()
})

it('hands analytics the key only in a production build', async () => {
  vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test')
  const { startServices } = await import('./startServices')
  vi.stubEnv('PROD', false)
  startServices()
  expect(startAnalytics).toHaveBeenLastCalledWith({ key: undefined })
  vi.stubEnv('PROD', true)
  startServices()
  expect(startAnalytics).toHaveBeenLastCalledWith({ key: 'phc_test' })
})

it('runs from the entry before the app mounts', () => {
  const entry = readFileSync(join(import.meta.dirname, '../main.tsx'), 'utf8')
  const start = entry.indexOf('startServices()')
  expect(start).toBeGreaterThan(-1)
  expect(start).toBeLessThan(entry.indexOf('createRoot(element)'))
  // A missing Clerk key throws, and that throw is reported only if Sentry is already running.
  expect(start).toBeLessThan(entry.indexOf("throw new Error('VITE_CLERK_PUBLISHABLE_KEY"))
})
