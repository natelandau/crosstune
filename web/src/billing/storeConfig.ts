export interface StoreConfig {
  /** Empty hides purchasing. */
  webKey: string
  /** Empty hides the Manage link. */
  portalUrl: string
}

export function storeConfig(source: ImportMetaEnv = import.meta.env): StoreConfig {
  return {
    webKey: source.VITE_REVENUECAT_WEB_KEY?.trim() ?? '',
    portalUrl: source.VITE_STRIPE_PORTAL_URL?.trim() ?? '',
  }
}
