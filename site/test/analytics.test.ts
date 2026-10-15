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

const BEACON = { send_instantly: true, transport: 'sendBeacon' }

describe('trackCreateAccount', () => {
  it('captures the placement, sent at once by beacon, after start', async () => {
    const { startAnalytics, trackCreateAccount } = await import('../src/scripts/analytics')
    await startAnalytics('phc_x')
    trackCreateAccount('hero')
    expect(posthog.capture).toHaveBeenCalledTimes(1)
    expect(posthog.capture).toHaveBeenCalledWith(
      'create_account_clicked',
      { placement: 'hero' },
      BEACON,
    )
  })

  it('does nothing before start', async () => {
    const { trackCreateAccount } = await import('../src/scripts/analytics')
    trackCreateAccount('nav')
    expect(posthog.capture).not.toHaveBeenCalled()
  })

  it('swallows a capture that throws', async () => {
    const { startAnalytics, trackCreateAccount } = await import('../src/scripts/analytics')
    await startAnalytics('phc_x')
    posthog.capture.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => trackCreateAccount('closing')).not.toThrow()
  })
})

describe('trackCreateAccountClicks', () => {
  // A stand-in document: the listener reads only the click target's nearest placement.
  function page() {
    type Listener = (event: { target: unknown; button: number }) => void
    const listeners: Record<string, Listener> = {}
    const root = {
      addEventListener: vi.fn((type: string, fn: Listener) => {
        listeners[type] = fn
      }),
    }
    const click = (placement: string | null, type = 'click', button = 0) =>
      listeners[type]!({
        button,
        target: {
          closest: () => (placement === null ? null : { dataset: { createAccount: placement } }),
        },
      })
    return { root, click }
  }

  it('sends the placement of a clicked Create account link', async () => {
    const { startAnalytics, trackCreateAccountClicks } = await import('../src/scripts/analytics')
    await startAnalytics('phc_x')
    const { root, click } = page()
    trackCreateAccountClicks(root as unknown as Document)
    click('pricing_premium')
    expect(posthog.capture).toHaveBeenCalledWith(
      'create_account_clicked',
      { placement: 'pricing_premium' },
      BEACON,
    )
  })

  it('ignores other clicks and placements the plan does not list', async () => {
    const { startAnalytics, trackCreateAccountClicks } = await import('../src/scripts/analytics')
    await startAnalytics('phc_x')
    const { root, click } = page()
    trackCreateAccountClicks(root as unknown as Document)
    click(null)
    click('footer')
    expect(posthog.capture).not.toHaveBeenCalled()
  })

  it('counts a middle-click open, but no other auxiliary button', async () => {
    const { startAnalytics, trackCreateAccountClicks } = await import('../src/scripts/analytics')
    await startAnalytics('phc_x')
    const { root, click } = page()
    trackCreateAccountClicks(root as unknown as Document)
    click('hero', 'auxclick', 2)
    expect(posthog.capture).not.toHaveBeenCalled()
    click('hero', 'auxclick', 1)
    expect(posthog.capture).toHaveBeenCalledTimes(1)
    expect(posthog.capture).toHaveBeenCalledWith(
      'create_account_clicked',
      { placement: 'hero' },
      BEACON,
    )
  })
})
