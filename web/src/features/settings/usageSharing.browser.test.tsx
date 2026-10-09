import { expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { SHARE_USAGE_KEY } from '../../usage/usageSharing'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/renderApp'
import { USAGE_DATA_FOOTER, USAGE_DATA_TITLE } from './settingsCopy'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

async function mount(stored?: 'false') {
  localStorage.removeItem(SHARE_USAGE_KEY)
  if (stored) localStorage.setItem(SHARE_USAGE_KEY, stored)
  onTestFinished(() => localStorage.removeItem(SHARE_USAGE_KEY))
  const analytics = recordingAnalytics()
  await renderApp({
    path: '/settings',
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

it('shows the switch on by default with its footer', async () => {
  await mount()
  await expect.element(toggle()).toBeChecked()
  await expect.element(page.getByText(USAGE_DATA_FOOTER)).toBeVisible()
})

it('turning it off records disable and stores false', async () => {
  const analytics = await mount()
  await press()
  await expect.element(toggle()).not.toBeChecked()
  await expect.poll(() => toggles(analytics)).toEqual([{ type: 'disable' }])
  await expect.poll(() => localStorage.getItem(SHARE_USAGE_KEY)).toBe('false')
})

it('turning it back on records enable and stores true', async () => {
  const analytics = await mount()
  await press()
  await expect.poll(() => localStorage.getItem(SHARE_USAGE_KEY)).toBe('false')
  await press()
  await expect.element(toggle()).toBeChecked()
  await expect.poll(() => toggles(analytics)).toEqual([{ type: 'disable' }, { type: 'enable' }])
  await expect.poll(() => localStorage.getItem(SHARE_USAGE_KEY)).toBe('true')
})

it('starts off when the device stored off', async () => {
  await mount('false')
  await expect.element(toggle()).not.toBeChecked()
})
