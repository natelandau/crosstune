// Labels and targets the nav, the hero, and the closing band share.
const PRODUCTION_APP_URL = 'https://my.crosstune.app'

// An unset or empty PUBLIC_APP_URL falls back to production; `just dev` points it at the local app.
export const resolveAppUrl = (value: string | undefined) =>
  value?.trim().replace(/\/+$/, '') || PRODUCTION_APP_URL

export const APP_URL = resolveAppUrl(import.meta.env.PUBLIC_APP_URL)
export const SIGN_IN = 'Sign in'
export const ALREADY_SIGNED_UP = 'Already have an account?'
export const HOME_LINK = 'Crosstune home'
export const WAITLIST_ID = 'waitlist'
export const JOIN_WAITLIST = 'Join the waitlist'
/** The nav button's label where the full one does not fit. */
export const JOIN_WAITLIST_SHORT = 'Join waitlist'
export const SUPPORT_EMAIL = 'support@crosstune.app'
/** The nav's links to the home page's sections: label, then section id. */
export const SECTIONS = [
  ['Features', 'features'],
  ['Pricing', 'pricing'],
  ['FAQ', 'questions'],
] as const
export const NATE_EMAIL = 'nate@crosstune.app'
