import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { act, render } from '@testing-library/react'
import { AnalyticsProvider } from '../analytics/AnalyticsProvider'
import { recordingAnalytics } from '../analytics/testing'
import { openTestDb } from '../test/db'
import { mountPlaying, openPractice } from '../test/practice'
import { rememberedLocation } from './destinations'
import { NOT_FOUND_TITLE } from './NotFoundPage'
import { SignIn } from './SignIn'
import { renderApp } from '../test/renderApp'
import { tuneRow, userTuneRow } from '../test/rows'

// Settings reads who is signed in, and the tests mount no Clerk.
vi.mock('@clerk/react', () => import('../fixture/clerkStub'))

const screens = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.calls.flatMap((call) => (call.type === 'screen' ? [call.name] : []))

async function mount(path: string) {
  const analytics = recordingAnalytics()
  const db = openTestDb()
  await db.tunes.put(tuneRow('t1', "Soldier's Joy"))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
  const result = await renderApp({
    path,
    db,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  return { analytics, router: result.router }
}

it('reports each screen as the path changes', async () => {
  const { analytics, router } = await mount('/catalog')
  await act(() => router.navigate('/catalog/t1'))
  await act(() => router.navigate('/lists'))
  await expect.poll(() => screens(analytics)).toEqual(['catalog', 'tune', 'lists'])
})

it('reports nothing for a search-only change', async () => {
  const { analytics, router } = await mount('/catalog')
  await expect.poll(() => screens(analytics)).toEqual(['catalog'])
  await act(() => router.navigate('/catalog?q=reel'))
  // Remembered by the same layout's effect that reports a screen, so the search has committed.
  await expect.poll(() => rememberedLocation('catalog')).toBe('/catalog?q=reel')
  expect(screens(analytics)).toEqual(['catalog'])
  await act(() => router.navigate('/lists'))
  await expect.poll(() => screens(analytics)).toEqual(['catalog', 'lists'])
})

it('reports nothing for the not-found page', async () => {
  const { analytics, router } = await mount('/nowhere')
  await expect.element(page.getByRole('main', { name: NOT_FOUND_TITLE })).toBeVisible()
  // The next screen is reported first, so the not-found page reported nothing before it.
  await act(() => router.navigate('/catalog'))
  await expect.poll(() => screens(analytics)).toEqual(['catalog'])
})

it('reports recording when practice opens', async () => {
  const analytics = recordingAnalytics()
  await mountPlaying(
    { width: 1280, height: 800 },
    { wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider> },
  )
  await openPractice()
  await expect
    .poll(() => screens(analytics).filter((s) => s === 'recording'))
    .toEqual(['recording'])
})

it('reports welcome once when sign-in mounts', async () => {
  const analytics = recordingAnalytics()
  render(
    <AnalyticsProvider client={analytics}>
      <SignIn staleSession />
    </AnalyticsProvider>,
  )
  await expect.poll(() => screens(analytics)).toEqual(['welcome'])
})
