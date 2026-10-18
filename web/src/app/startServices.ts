import { registerSW } from 'virtual:pwa-register'
import { createApiClient } from '../api/client'
import { API_ORIGIN } from '../config'
import { APP_VERSION } from '../version'
import { startAnalytics, type AnalyticsClient } from '../usage/client'
import { startErrorReporting } from '../errorReporting'

/**
 * Starts what runs beside the app for the life of the page: error reporting, analytics, and
 * the service worker. Returns the analytics client for the app to provide.
 */
export function startServices(): AnalyticsClient {
  startErrorReporting()
  // Only a production build sends, even when a development `.env` holds the key.
  const key = import.meta.env.PROD ? import.meta.env.VITE_POSTHOG_KEY : undefined
  // The region call needs no session, so this client never holds a token.
  const api = createApiClient({
    baseUrl: API_ORIGIN,
    getToken: () => Promise.resolve(null),
    clientVersion: APP_VERSION,
  })
  const analytics = startAnalytics({ key, fetchRegion: () => api.region() })
  registerSW({ immediate: true })
  return analytics
}
