import { registerSW } from 'virtual:pwa-register'
import { startAnalytics, type AnalyticsClient } from '../analytics/client'
import { startErrorReporting } from '../errorReporting'

/**
 * Starts what runs beside the app for the life of the page: error reporting, analytics, and
 * the service worker. Returns the analytics client for the app to provide.
 */
export function startServices(): AnalyticsClient {
  startErrorReporting()
  // Only a production build sends, even when a development `.env` holds the key.
  const key = import.meta.env.PROD ? import.meta.env.VITE_POSTHOG_KEY : undefined
  const analytics = startAnalytics({ key })
  registerSW({ immediate: true })
  return analytics
}
