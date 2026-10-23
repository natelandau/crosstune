import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { settingsId } from '../../commands/settings'
import { openTestDb } from '../../test/db'
import { renderApp } from '../../test/renderApp'
import { userSettingsRow } from '../../test/rows'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import {
  a4Label,
  LOWER_REFERENCE_PITCH,
  RAISE_REFERENCE_PITCH,
  REFERENCE_PITCH,
} from './settingsCopy'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

async function mount(stored?: number) {
  const db = openTestDb()
  if (stored !== undefined) {
    await db.user_settings.put(userSettingsRow(settingsId('user_1'), { tuner_a4_hz: stored }))
  }
  const analytics = recordingAnalytics()
  await renderApp({
    path: '/settings/tuner',
    db,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  return { db, analytics }
}

const raise = () => page.getByRole('button', { name: RAISE_REFERENCE_PITCH })
const reading = (text: string) => page.getByRole('status').filter({ hasText: text })
const lower = () => page.getByRole('button', { name: LOWER_REFERENCE_PITCH })

it('steps the reference pitch and stops at the ends', async () => {
  await mount()
  await expect.element(page.getByText(REFERENCE_PITCH, { exact: true })).toBeVisible()
  await expect.element(reading(a4Label(440))).toBeVisible()
  await raise().click()
  await expect.element(reading(a4Label(441))).toBeVisible()
  await lower().click()
  await expect.element(reading(a4Label(440))).toBeVisible()
})

it.each([
  [450, raise, lower],
  [430, lower, raise],
])('disables the step past %s Hz and leaves the other', async (hz, past, back) => {
  await mount(hz)
  await expect.element(reading(a4Label(hz))).toBeVisible()
  await expect.element(past()).toBeDisabled()
  await expect.element(back()).toBeEnabled()
})

it('names the reading with its row label', async () => {
  await mount()
  const group = page.getByRole('group', { name: REFERENCE_PITCH, exact: true })
  await expect.element(group.getByRole('status')).toHaveTextContent(a4Label(440))
})

it.each([
  [449, raise, lower],
  [431, lower, raise],
])('moves focus off a step as it reaches its bound from %s Hz', async (hz, step, other) => {
  await mount(hz)
  await expect.element(reading(a4Label(hz))).toBeVisible()
  await step().click()
  await expect.element(step()).toBeDisabled()
  await expect.element(other()).toHaveFocus()
})

it('sends setting_changed and stores the value', async () => {
  const { db, analytics } = await mount()
  await expect.element(reading(a4Label(440))).toBeVisible()
  await raise().click()
  await expect
    .poll(() => analytics.sends())
    .toEqual([{ name: 'setting_changed', props: { setting: 'tuner_a4_hz', value: 441 } }])
  await expect
    .poll(async () => (await db.user_settings.get(settingsId('user_1')))?.tuner_a4_hz)
    .toBe(441)
})
