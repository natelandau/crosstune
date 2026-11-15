import type { PostHog, PostHogConfig } from 'posthog-js'

// First-party proxy host, so blockers keyed on PostHog's own domains do not drop events.
export const ANALYTICS_HOST = 'https://relay.crosstune.app'

// A tracked click navigates away at once, and only a beacon sent at once outlives it.
const OUTBOUND_CAPTURE_OPTIONS = { send_instantly: true, transport: 'sendBeacon' } as const

/** Where a Create account link sits, carried on each link as `data-create-account`. */
export const PLACEMENTS = ['nav', 'hero', 'closing', 'pricing_free', 'pricing_premium'] as const
export type Placement = (typeof PLACEMENTS)[number]

/** Where an App Store link sits, carried on each link as `data-app-store`. */
export const APP_STORE_PLACEMENTS = ['hero', 'closing', 'platforms', 'footer'] as const
export type AppStorePlacement = (typeof APP_STORE_PLACEMENTS)[number]

// Each tracked link's data attribute, as `dataset` names it, with its event and placements.
const TRACKED_LINKS = [
  { key: 'createAccount', event: 'create_account_clicked', placements: PLACEMENTS },
  { key: 'appStore', event: 'app_store_clicked', placements: APP_STORE_PLACEMENTS },
] as const
const TRACKED_SELECTOR = TRACKED_LINKS.map(
  ({ key }) => `[data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`,
).join(', ')

// Registered on every event, so the site's events split from the apps' in one PostHog project.
export const SITE_SUPER_PROPERTIES = { product: 'site', platform: 'site' } as const

// The tracking plan's site builtins are each switched on here, which its contract test checks.
export const SITE_POSTHOG_CONFIG = {
  api_host: ANALYTICS_HOST,
  ui_host: 'https://us.posthog.com',
  // Cookieless: nothing stored in the browser, so no consent banner.
  cookieless_mode: 'always',
  person_profiles: 'identified_only',
  autocapture: true,
  disable_session_recording: true,
  disable_surveys: true,
  capture_pageview: true,
  capture_heatmaps: true,
  capture_performance: { web_vitals: true, network_timing: false },
  // Off here, so a setting in the PostHog dashboard cannot turn them on.
  capture_dead_clicks: false,
  capture_exceptions: false,
  advanced_disable_flags: true,
} as const satisfies Partial<PostHogConfig>

let loading: Promise<void> | null = null
let client: PostHog | null = null

// Analytics is never worth competing with the page's own work.
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 3000 })
    } else {
      setTimeout(resolve, 1)
    }
  })
}

export function startAnalytics(token: string | undefined): Promise<void> {
  if (!token) return Promise.resolve()
  loading ??= load(token)
  return loading
}

async function load(token: string): Promise<void> {
  try {
    await whenIdle()
    const { default: posthog } = await import('posthog-js')
    posthog.init(token, SITE_POSTHOG_CONFIG)
    posthog.register(SITE_SUPER_PROPERTIES)
    client = posthog
  } catch {
    // Analytics is optional; a blocked or failed load must not surface to the visitor.
  }
}

// PostHog adds the referrer and the landing URL's campaign tags itself, so only the placement is
// passed. A click before analytics has loaded goes unrecorded, since the page is already leaving.
function captureOutbound(event: string, placement: string): void {
  try {
    client?.capture(event, { placement }, OUTBOUND_CAPTURE_OPTIONS)
  } catch {
    // The visitor is on the way out; a tracking failure must not stop them.
  }
}

export function trackCreateAccount(placement: Placement): void {
  captureOutbound('create_account_clicked', placement)
}

/** Sends a Create account or App Store click from anywhere in `root`, by the link's placement. */
export function trackLinkClicks(root: Document): void {
  const track = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.<HTMLElement>(TRACKED_SELECTOR)
    for (const { key, event: name, placements } of TRACKED_LINKS) {
      const placement = link?.dataset[key]
      if (placement && (placements as readonly string[]).includes(placement)) {
        return captureOutbound(name, placement)
      }
    }
  }
  root.addEventListener('click', track)
  // A middle-click opens the link in a new tab and fires only auxclick.
  root.addEventListener('auxclick', (event) => {
    if (event.button === 1) track(event)
  })
}
