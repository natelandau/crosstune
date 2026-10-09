import type { PostHogConfig } from 'posthog-js'
import { scrubEvent, scrubUrl } from './scrub'

// First-party proxy host, so blockers keyed on PostHog's own domains do not drop events.
export const ANALYTICS_HOST = 'https://relay.crosstune.app'

type MaskRequest = NonNullable<
  NonNullable<PostHogConfig['session_recording']['maskCapturedNetworkRequestFn']>
>

// The recorder passes every URL it writes into a replay, page navigations included, through
// this hook, and returning nothing would drop the entry and break playback. Headers and bodies
// are always removed, whatever the project's replay settings enable, because API bodies carry
// tune titles, lyrics, and notes.
export const maskCapturedRequest: MaskRequest = (request) => {
  const rest = { ...request }
  delete rest.requestHeaders
  delete rest.requestBody
  delete rest.responseHeaders
  delete rest.responseBody
  return { ...rest, name: scrubUrl(request.name ?? '') }
}

// Attributes that can hold user words: accessible names carry tune and list titles, and
// `data-title` and `data-set` carry a title or a filter value.
const WORD_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'aria-placeholder',
  'aria-roledescription',
  'title',
  'alt',
  'placeholder',
  'label',
  'value',
  'download',
  'srcdoc',
  'data-title',
  'data-set',
])

// rrweb's names for these include the `rr_src` it writes in place of an iframe's `src`.
const URL_ATTRIBUTES = new Set(['href', 'xlink:href', 'src', 'rr_src', 'poster', 'action'])

export const MASKED_ATTRIBUTE = '***'

function sameOriginUrl(value: string, page: URL): string {
  try {
    const url = new URL(value.trim(), page)
    return url.origin === page.origin ? scrubUrl(url.href) : ''
  } catch {
    return ''
  }
}

/**
 * One attribute as a replay records it. Words become a fixed mask; a URL on the app's own
 * origin keeps only its route pattern, and any other URL, such as a saved link or an embed,
 * is blanked. Everything else, such as `class` and `style`, stays so the replay still draws.
 */
export function maskReplayAttribute(name: string, value: string, pageUrl: string): string {
  const key = name.toLowerCase()
  if (WORD_ATTRIBUTES.has(key)) return MASKED_ATTRIBUTE
  if (!URL_ATTRIBUTES.has(key) && key !== 'srcset') return value
  let page: URL
  try {
    page = new URL(pageUrl)
  } catch {
    return ''
  }
  if (key !== 'srcset') return sameOriginUrl(value, page)
  return value
    .split(',')
    .map((candidate) => {
      const [url = '', ...descriptor] = candidate.trim().split(/\s+/)
      const kept = sameOriginUrl(url, page)
      return kept ? [kept, ...descriptor].join(' ') : ''
    })
    .filter(Boolean)
    .join(', ')
}

type MaskAttribute = NonNullable<PostHogConfig['session_recording']['maskAttributeFn']>

const maskAttribute: MaskAttribute = (name, value) =>
  maskReplayAttribute(name, value, globalThis.location?.href ?? '')

// Replay masks all text, inputs, and the attributes that hold words or URLs, so it shows layout
// and taps, never content. `maskAllElementAttributes` stays unset: it would also mask `class`
// and `style`, and when the project setting turns it on the recorder ignores `maskAttributeFn`
// and masks every attribute, which fails closed. The settings the dashboard cannot override are
// the ones read locally: the capture_* switches here.
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
  disable_session_recording: false,
  enable_recording_console_log: false,
  session_recording: {
    maskAllInputs: true,
    maskTextSelector: '*',
    maskAttributeFn: maskAttribute,
    recordHeaders: false,
    recordBody: false,
    maskCapturedNetworkRequestFn: maskCapturedRequest,
  },
  before_send: scrubEvent,
} as const satisfies Partial<PostHogConfig>
