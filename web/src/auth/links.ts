const PRODUCTION_SITE_URL = 'https://crosstune.app'

// An unset or empty VITE_SITE_URL falls back to production; `just dev` points it at the local site.
export const resolveSiteUrl = (value: string | undefined) =>
  value?.trim().replace(/\/+$/, '') || PRODUCTION_SITE_URL

// Playwright imports this module through AuthGate, where Vite has defined no import.meta.env.
export const SITE_URL = resolveSiteUrl(import.meta.env?.VITE_SITE_URL)

export const SIGN_IN_PATH = '/'
export const SIGN_UP_PATH = '/sign-up'

export const SPLASH_LABEL = 'Loading'

export const SIGN_IN_HEADLINE = 'The tune list in your case, rebuilt for your phone.'
export const SIGN_IN_LINE =
  "The tunes you know and the tunes you're learning, with a recording close at hand."
export const SIGN_UP_LINE = 'Free forever, with 30 days of Premium included. No card needed.'
