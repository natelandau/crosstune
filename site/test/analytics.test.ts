import { beforeEach, describe, expect, it, vi } from 'vitest'

const posthog = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn(), register: vi.fn() }))
vi.mock('posthog-js', () => ({ default: posthog }))

beforeEach(() => {
  vi.resetModules()
  posthog.init.mockReset()
  posthog.capture.mockReset()
  posthog.register.mockReset()
})

describe('startAnalytics', () => {
  it.each([undefined, ''])('does not start without a token (%j)', async (token) => {
    const { startAnalytics } = await import('../src/scripts/analytics')
    await startAnalytics(token)
    expect(posthog.init).not.toHaveBeenCalled()
  })

  it('starts PostHog through the relay, cookieless, with clicks and page speed', async () => {
    const { startAnalytics, ANALYTICS_HOST } = await import('../src/scripts/analytics')
    expect(ANALYTICS_HOST).toBe('https://relay.crosstune.app')
    await startAnalytics('phc_x')
    expect(posthog.init).toHaveBeenCalledTimes(1)
    expect(posthog.init).toHaveBeenCalledWith(
      'phc_x',
      expect.objectContaining({
        api_host: 'https://relay.crosstune.app',
        ui_host: 'https://us.posthog.com',
        cookieless_mode: 'always',
        person_profiles: 'identified_only',
        autocapture: true,
        disable_session_recording: true,
        disable_surveys: true,
        capture_pageview: true,
        capture_heatmaps: true,
        capture_performance: { web_vitals: true, network_timing: false },
        // Off here, so the PostHog dashboard cannot turn them on.
        capture_dead_clicks: false,
        capture_exceptions: false,
        advanced_disable_flags: true,
      }),
    )
  })

  it("registers the site's product and platform on every event", async () => {
    const { startAnalytics } = await import('../src/scripts/analytics')
    await startAnalytics('phc_x')
    expect(posthog.register).toHaveBeenCalledTimes(1)
    expect(posthog.register).toHaveBeenCalledWith({ product: 'site', platform: 'site' })
  })

  it('does not init twice when started again', async () => {
    const { startAnalytics } = await import('../src/scripts/analytics')
    await Promise.all([startAnalytics('phc_x'), startAnalytics('phc_x')])
    await startAnalytics('phc_x')
    expect(posthog.init).toHaveBeenCalledTimes(1)
  })

  it('waits for an idle moment before loading', async () => {
    const idle = vi.fn<(cb: () => void, opts?: { timeout: number }) => void>()
    vi.stubGlobal('requestIdleCallback', idle)
    try {
      const { startAnalytics } = await import('../src/scripts/analytics')
      const started = startAnalytics('phc_x')
      expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 })
      expect(posthog.init).not.toHaveBeenCalled()
      idle.mock.calls[0]![0]()
      await started
      expect(posthog.init).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('trackWaitlistJoined', () => {
  it('captures with the acquisition it is given, sent at once by beacon, after start', async () => {
    const { startAnalytics, trackWaitlistJoined } = await import('../src/scripts/analytics')
    await startAnalytics('phc_x')
    await trackWaitlistJoined({ $referrer: 'https://forum.example/', utm_source: 'newsletter' })
    expect(posthog.capture).toHaveBeenCalledTimes(1)
    expect(posthog.capture).toHaveBeenCalledWith(
      'waitlist_joined',
      { $referrer: 'https://forum.example/', utm_source: 'newsletter' },
      {
        send_instantly: true,
        transport: 'sendBeacon',
      },
    )
  })

  it('sends a join made while analytics is still loading once it has loaded', async () => {
    const idle = vi.fn<(cb: () => void, opts?: { timeout: number }) => void>()
    vi.stubGlobal('requestIdleCallback', idle)
    try {
      const { startAnalytics, trackWaitlistJoined } = await import('../src/scripts/analytics')
      const started = startAnalytics('phc_x')
      const tracked = trackWaitlistJoined({})
      expect(posthog.capture).not.toHaveBeenCalled()
      idle.mock.calls[0]![0]()
      await started
      await tracked
      expect(posthog.capture).toHaveBeenCalledTimes(1)
      expect(posthog.capture).toHaveBeenCalledWith(
        'waitlist_joined',
        {},
        {
          send_instantly: true,
          transport: 'sendBeacon',
        },
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does nothing before start', async () => {
    const { trackWaitlistJoined } = await import('../src/scripts/analytics')
    await trackWaitlistJoined({})
    expect(posthog.capture).not.toHaveBeenCalled()
  })

  it('swallows a capture that throws', async () => {
    const { startAnalytics, trackWaitlistJoined } = await import('../src/scripts/analytics')
    await startAnalytics('phc_x')
    posthog.capture.mockImplementation(() => {
      throw new Error('boom')
    })
    await expect(trackWaitlistJoined({})).resolves.toBeUndefined()
  })
})
