import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SITE_POSTHOG_CONFIG, SITE_SUPER_PROPERTIES } from '../src/scripts/analytics'
import { ACQUISITION_KEYS } from '../src/scripts/waitlist'

interface Plan {
  enums: Record<string, string[]>
  super_properties: Record<string, { enum?: string; clients: string[] }>
  events: Record<
    string,
    { clients: string[]; builtin?: boolean; properties: Record<string, unknown> }
  >
}

type SiteConfig = typeof SITE_POSTHOG_CONFIG

// Each PostHog builtin the site may send, beside the init setting that turns it on.
const BUILTIN_SWITCHES: Record<string, (config: SiteConfig) => boolean> = {
  $pageview: (config) => config.capture_pageview,
  $pageleave: (config) => config.capture_pageview,
  $autocapture: (config) => config.autocapture,
  // PostHog turns rage clicks on with autocapture unless `rageclick` says otherwise.
  $rageclick: (config) => config.autocapture,
  $$heatmap: (config) => config.capture_heatmaps,
  $web_vitals: (config) => config.capture_performance.web_vitals,
}

const plan = JSON.parse(
  readFileSync(new URL('../../analytics/tracking-plan.json', import.meta.url), 'utf8'),
) as Plan

describe('tracking plan', () => {
  it('every super property the site registers is in the plan for the site', () => {
    for (const [name, value] of Object.entries(SITE_SUPER_PROPERTIES)) {
      const spec = plan.super_properties[name]
      expect(spec, name).toBeDefined()
      expect(spec!.clients).toContain('site')
      expect(plan.enums[spec!.enum!]).toContain(value)
    }
  })

  it('the site sends only the events the plan lists for it', () => {
    const listed = Object.entries(plan.events)
      .filter(([, event]) => !event.builtin && event.clients.includes('site'))
      .map(([name]) => name)
    expect(listed).toEqual(['waitlist_joined'])
  })

  it('turns on exactly the builtins the plan lists for the site', () => {
    const listed = Object.entries(plan.events)
      .filter(([, event]) => event.builtin && event.clients.includes('site'))
      .map(([name]) => name)
    expect(listed.sort()).toEqual(Object.keys(BUILTIN_SWITCHES).sort())
    for (const name of listed) {
      expect(BUILTIN_SWITCHES[name]!(SITE_POSTHOG_CONFIG), name).toBe(true)
    }
  })

  it('waitlist_joined sends only plan properties', () => {
    expect([...ACQUISITION_KEYS].sort()).toEqual(
      Object.keys(plan.events.waitlist_joined!.properties).sort(),
    )
  })
})
