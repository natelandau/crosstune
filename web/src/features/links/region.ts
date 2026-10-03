/**
 * The device's region for storefront-specific searches, `US` when the locale names none or
 * names a numeric region such as `419`, which the search route refuses.
 */
export function deviceCountry(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region
    return region && /^[A-Za-z]{2}$/.test(region) ? region : 'US'
  } catch {
    return 'US'
  }
}
