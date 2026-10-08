import { registerSW } from 'virtual:pwa-register'
import { startErrorReporting } from '../errorReporting'

/** Starts what runs beside the app for the life of the page: error reporting and the service worker. */
export function startServices(): void {
  startErrorReporting()
  registerSW({ immediate: true })
}
