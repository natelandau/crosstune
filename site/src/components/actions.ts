// Labels and targets the nav, the hero, the pricing cards, and the closing band share.
const PRODUCTION_APP_URL = 'https://my.crosstune.app'

// An unset or empty PUBLIC_APP_URL falls back to production; `just dev` points it at the local app.
export const resolveAppUrl = (value: string | undefined) =>
  value?.trim().replace(/\/+$/, '') || PRODUCTION_APP_URL

export const APP_URL = /* @__PURE__ */ resolveAppUrl(import.meta.env.PUBLIC_APP_URL)
export const SIGN_IN = 'Sign in'
export const ALREADY_SIGNED_UP = 'Already have an account?'
export const HOME_LINK = 'Crosstune home'
/** The web app's sign-up screen, where every Create account link goes. */
export const SIGN_UP_URL = `${APP_URL}/sign-up`
export const CREATE_FREE_ACCOUNT = 'Create free account'
/** Where "free" does not fit or reads oddly: the nav and the Premium card. */
export const CREATE_ACCOUNT = 'Create account'
export const PREMIUM_INCLUDED = '30 days of Premium included'
export const NO_CARD = 'No card needed'
/** The closing band's anchor. */
export const START_ID = 'start'
export const SUPPORT_EMAIL = 'support@crosstune.app'
/** The site's own origin, with no trailing slash. */
export const SITE_URL = 'https://crosstune.app'
/** The nav's links to the home page's sections: label, then section id. */
export const SECTIONS = [
  ['Features', 'features'],
  ['Pricing', 'pricing'],
  ['FAQ', 'questions'],
] as const
export const NATE_EMAIL = 'nate@crosstune.app'
