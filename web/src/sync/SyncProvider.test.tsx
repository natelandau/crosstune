import { act, render, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { DbContext } from '../db/DbProvider'
import { openTestDb } from '../test/db'
import { testSession } from '../test/providers'
import { AnalyticsProvider } from '../usage/AnalyticsProvider'
import { recordingAnalytics } from '../usage/testing'
import { SyncProvider, useOnline } from './SyncProvider'

describe('useOnline', () => {
  it('follows the browser online and offline events', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const { result } = renderHook(() => useOnline())
    expect(result.current).toBe(true)

    onLine.mockReturnValue(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)
  })
})

describe('SyncProvider', () => {
  it('reports a created account only once the session user is identified', async () => {
    let created = false
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (!created) headers['X-Account-Created'] = 'trial'
      created = true
      return new Response('{}', { status: 200, headers })
    })
    const analytics = recordingAnalytics()
    const whenIdentified = vi.spyOn(analytics, 'whenIdentified')
    const sentAccountCreated = () =>
      analytics.calls.filter((call) => call.type === 'send' && call.name === 'account_created')
    render(
      <AnalyticsProvider client={analytics}>
        <AuthProvider value={testSession}>
          <DbContext.Provider value={openTestDb()}>
            <SyncProvider>{null}</SyncProvider>
          </DbContext.Provider>
        </AuthProvider>
      </AnalyticsProvider>,
    )
    await expect.poll(() => whenIdentified.mock.calls.length).toBe(1)
    expect(fetch).toHaveBeenCalled()
    expect(whenIdentified.mock.calls[0]?.[0]).toBe(testSession.userId)
    expect(sentAccountCreated()).toEqual([])

    analytics.identify(testSession.userId, {})
    await expect
      .poll(sentAccountCreated)
      .toEqual([{ type: 'send', name: 'account_created', props: { trial: true } }])
    const types = analytics.calls.map((call) => call.type)
    expect(types.lastIndexOf('identify')).toBeLessThan(types.lastIndexOf('send'))
  })
})
