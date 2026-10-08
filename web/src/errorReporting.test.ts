import { describe, expect, it } from 'vitest'
import { sentryOptions } from './errorReporting'
import { scrubR2Breadcrumb } from './sentryBreadcrumbs'
import { APP_VERSION } from './version'

describe('sentryOptions', () => {
  it('reports nothing without a DSN', () => {
    expect(sentryOptions({})).toBeNull()
  })

  it('tags each report with the release and environment, and scrubs R2 links', () => {
    const options = sentryOptions({
      VITE_SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1',
      VITE_SENTRY_ENVIRONMENT: 'production',
    })
    expect(options?.dsn).toBe('https://key@o1.ingest.sentry.io/1')
    expect(options?.release).toBe(APP_VERSION)
    expect(options?.environment).toBe('production')
    expect(options?.beforeBreadcrumb).toBe(scrubR2Breadcrumb)
  })

  it('names the environment development when the build sets none', () => {
    expect(
      sentryOptions({ VITE_SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1' })?.environment,
    ).toBe('development')
  })

  it('collects no user info, cookies, or bodies', () => {
    const data = sentryOptions({
      VITE_SENTRY_DSN: 'https://key@o1.ingest.sentry.io/1',
    })?.dataCollection
    expect(data?.userInfo).toBe(false)
    expect(data?.cookies).toBe(false)
    expect(data?.httpBodies).toEqual([])
  })
})
