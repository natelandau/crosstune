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

export const WELCOME_REASON =
  'Free to use, no card needed. Your account syncs your tunes to your phone, iPad, Mac, and any browser.'

export const SIGN_UP_TITLE = 'Create your free account'

export const WHY_ACCOUNT_LINK = 'Why do I need an account?'
export const WHY_ACCOUNT_TITLE = 'Why an account?'
export const WHY_ACCOUNT_BODY: readonly string[] = [
  'Your catalog lives on this device and works offline. Your account copies it to your other devices: an iPhone, an iPad, a Mac, or any web browser.',
  'The account is free, with no card. Only you can see your catalog. You can export it or delete it at any time.',
]
export const WHY_ACCOUNT_DONE = 'Done'

export const WELCOME_SLIDES: readonly {
  id: 'story' | 'catalog' | 'record' | 'practice' | 'listen' | 'tuner'
  headline: string
}[] = [
  { id: 'story', headline: SIGN_IN_HEADLINE },
  { id: 'catalog', headline: 'Filter your tunes by key, tuning, time signature, and more.' },
  { id: 'record', headline: 'Your tune list and your recordings, finally in one place.' },
  { id: 'practice', headline: 'Slow it down. Loop the hard part.' },
  { id: 'listen', headline: 'Play any tune from the services you already use.' },
  { id: 'tuner', headline: 'Tune up without leaving the app.' },
]

export const SLIDE_COUNT = WELCOME_SLIDES.length
export const slideDotLabel = (n: number) => `Slide ${n} of ${SLIDE_COUNT}`
export const slideLabel = (n: number) => `${n} of ${SLIDE_COUNT}`
export const PREVIOUS_SLIDE = 'Previous slide'
export const NEXT_SLIDE = 'Next slide'
