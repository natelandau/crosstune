import type { PostHogConfig } from 'posthog-js'
import { scrubEvent } from './scrub'

// First-party proxy host, so blockers keyed on PostHog's own domains do not drop events.
export const ANALYTICS_HOST = 'https://relay.crosstune.app'

export const WEB_POSTHOG_CONFIG = {
  api_host: ANALYTICS_HOST,
  persistence: 'localStorage',
  person_profiles: 'identified_only',
  capture_pageview: false,
  capture_pageleave: false,
  autocapture: false,
  rageclick: false,
  capture_heatmaps: false,
  capture_dead_clicks: false,
  capture_exceptions: false,
  capture_performance: { network_timing: false, web_vitals: false },
  disable_surveys: true,
  advanced_disable_flags: true,
  disable_session_recording: true,
  before_send: scrubEvent,
} as const satisfies Partial<PostHogConfig>
