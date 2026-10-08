import * as Sentry from '@sentry/react'
import { scrubR2Breadcrumb } from './sentryBreadcrumbs'
import { APP_VERSION } from './version'

interface ReportingEnv {
  VITE_SENTRY_DSN?: string
  VITE_SENTRY_ENVIRONMENT?: string
}

const DENIED_HEADERS = ['forwarded', '-ip', 'remote-', 'via', '-user']

/** Sentry's options for this build, or null when no DSN is set and nothing reports. */
export function sentryOptions(env: ReportingEnv): Sentry.BrowserOptions | null {
  if (!env.VITE_SENTRY_DSN) return null
  return {
    dsn: env.VITE_SENTRY_DSN,
    release: APP_VERSION,
    environment: env.VITE_SENTRY_ENVIRONMENT ?? 'development',
    beforeBreadcrumb: scrubR2Breadcrumb,
    // Sentry's defaults collect user info, cookies, and request and response bodies, and bodies
    // carry a user's own tunes. This is Sentry's documented restrictive baseline.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { deny: DENIED_HEADERS }, response: { deny: DENIED_HEADERS } },
      httpBodies: [],
      urlQueryParams: { deny: DENIED_HEADERS },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
    },
  }
}

export function startErrorReporting(env: ReportingEnv = import.meta.env): void {
  const options = sentryOptions(env)
  if (options) Sentry.init(options)
}
