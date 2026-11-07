import { deviceRegion } from '../../platform/deviceRegion'

/**
 * The device's region for storefront-specific searches, `US` when the locale names none or
 * names a numeric region such as `419`, which the search route refuses.
 */
export function deviceCountry(): string {
  const region = deviceRegion()
  return region && /^[A-Za-z]{2}$/.test(region) ? region : 'US'
}
