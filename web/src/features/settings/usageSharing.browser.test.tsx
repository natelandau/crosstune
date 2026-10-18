import { expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import { startAnalytics } from '../../usage/client'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { SHARE_USAGE_KEY } from '../../usage/usageSharing'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/renderApp'
import { USAGE_DATA_HELP, USAGE_DATA_TITLE } from './settingsCopy'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

async function mount(stored?: 'true' | 'false') {
  localStorage.removeItem(SHARE_USAGE_KEY)
  if (stored) localStorage.setItem(SHARE_USAGE_KEY, stored)
  onTestFinished(() => localStorage.removeItem(SHARE_USAGE_KEY))
  const analytics = recordingAnalytics()
  await renderApp({
    path: '/settings/account',
    db: openTestDb(),
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  return analytics
}

const toggles = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.calls.filter((call) => call.type !== 'screen')

const toggle = () => page.getByRole('switch', { name: USAGE_DATA_TITLE })
// The switch's input is visually hidden, so the press lands on its label.
const press = () => page.getByText(USAGE_DATA_TITLE, { exact: true }).click()

it('shows the switch off when nothing is stored, with its footer', async () => {
  await mount()
  await expect.element(toggle()).not.toBeChecked()
  await expect.element(page.getByText(USAGE_DATA_HELP)).toBeVisible()
})

it('turning it off records disable and stores false', async () => {
  const analytics = await mount('true')
  await press()
  await expect.element(toggle()).not.toBeChecked()
  await expect.poll(() => toggles(analytics)).toEqual([{ type: 'disable' }])
  await expect.poll(() => localStorage.getItem(SHARE_USAGE_KEY)).toBe('false')
})

it('turning it on records enable and stores true', async () => {
  const analytics = await mount()
  await press()
  await expect.element(toggle()).toBeChecked()
  await expect.poll(() => toggles(analytics)).toEqual([{ type: 'enable' }])
  await expect.poll(() => localStorage.getItem(SHARE_USAGE_KEY)).toBe('true')
})

it('starts on when the device stored on', async () => {
  await mount('true')
  await expect.element(toggle()).toBeChecked()
})

it('starts off when the device stored off', async () => {
  await mount('false')
  await expect.element(toggle()).not.toBeChecked()
})

it('turns on when the regional default settles after the row mounted', async () => {
  localStorage.removeItem(SHARE_USAGE_KEY)
  onTestFinished(() => localStorage.removeItem(SHARE_USAGE_KEY))
  let answer: (region: { consent_required: boolean | null }) => void = () => {}
  const analytics = startAnalytics({
    key: 'test',
    load: async () => ({
      init: () => {},
      register: () => {},
      capture: () => {},
      identify: () => {},
      setPersonProperties: () => {},
      reset: () => {},
      opt_in_capturing: () => {},
      opt_out_capturing: () => {},
    }),
    fetchRegion: () => new Promise((resolve) => (answer = resolve)),
  })
  await renderApp({
    path: '/settings/account',
    db: openTestDb(),
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  await expect.element(toggle()).not.toBeChecked()
  answer({ consent_required: false })
  await expect.element(toggle()).toBeChecked()
})

it('turns on when the regional default lands before the row subscribes', async () => {
  localStorage.removeItem(SHARE_USAGE_KEY)
  onTestFinished(() => localStorage.removeItem(SHARE_USAGE_KEY))
  const recording = recordingAnalytics()
  let landed = false
  // The default lands as the row subscribes, so the subscription never hears of it.
  const analytics = {
    ...recording,
    isSharing: () => landed,
    subscribeSharing: (listener: () => void) => {
      landed = true
      return recording.subscribeSharing(listener)
    },
  }
  await renderApp({
    path: '/settings/account',
    db: openTestDb(),
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  await expect.element(toggle()).toBeChecked()
})
