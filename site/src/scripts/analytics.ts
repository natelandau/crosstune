import type { PostHog } from 'posthog-js'

// First-party proxy host, so blockers keyed on PostHog's own domains do not drop events.
export const ANALYTICS_HOST = 'https://relay.crosstune.app'

// A beacon sent at once outlives a visitor who leaves the thanks page straight away.
export const WAITLIST_CAPTURE_OPTIONS = { send_instantly: true, transport: 'sendBeacon' } as const

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
    posthog.init(token, {
      api_host: ANALYTICS_HOST,
      ui_host: 'https://us.posthog.com',
      // No cookie or storage, so the site needs no consent banner.
      persistence: 'memory',
      person_profiles: 'identified_only',
      autocapture: false,
      disable_session_recording: true,
      disable_surveys: true,
      capture_pageview: true,
      // Off here, so a setting in the PostHog dashboard cannot turn them on.
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_performance: false,
      advanced_disable_flags: true,
    })
    client = posthog
  } catch {
    // Analytics is optional; a blocked or failed load must not surface to the visitor.
  }
}

// The thanks page sends this with no acquisition of its own, so the caller passes on the join
// page's, in PostHog's property names. A join reported while analytics is still loading is
// sent once it has loaded.
export async function trackWaitlistJoined(acquisition: Record<string, string>): Promise<void> {
  await loading
  try {
    client?.capture('waitlist_joined', acquisition, WAITLIST_CAPTURE_OPTIONS)
  } catch {
    // The join already succeeded; a tracking failure must not look like one.
  }
}
