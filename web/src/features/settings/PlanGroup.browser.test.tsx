import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { Store } from '../../billing/store'
import { StoreProvider } from '../../billing/StoreProvider'
import { useEntitlement } from '../../billing/usePlan'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalEntitlement } from '../../db/types'
import { openTestDb } from '../../test/db'
import { fakeStore } from '../../test/fakeStore'
import { dataProviders } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { entitlementRow } from '../../test/rows'
import { FixedNow } from '../../ui/useNow'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import {
  APP_STORE_SUBSCRIPTIONS_URL,
  FREE_HELP,
  FREE_STORAGE_HELP,
  MANAGE_APP_STORE,
  MANAGE_SUBSCRIPTION,
  PLAN_FREE,
  PLAN_GROUP,
  PLAN_PREMIUM,
  PLAN_TRIAL,
  premiumUntil,
  SUBSCRIBE,
  trialLeft,
} from '../plan/planCopy'
import { PremiumSheetProvider } from '../plan/PremiumSheetProvider'
import { PlanGroup } from './PlanGroup'

const config = vi.hoisted(() => ({ portalUrl: '' }))

vi.mock('../../billing/storeConfig', () => ({
  storeConfig: () => ({ webKey: 'key', portalUrl: config.portalUrl }),
}))
vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
  config.portalUrl = ''
})

const NOW = new Date(2026, 9, 10, 12)
const DAY = 86_400_000

/** Shows once the entitlements read has answered, so a test can tell "no row" from "not read yet". */
function SettledProbe() {
  return useEntitlement() === undefined ? null : <p data-testid="settled">settled</p>
}

async function mount(row?: Partial<LocalEntitlement>, store: Store | null = fakeStore()) {
  const analytics = recordingAnalytics()
  if (row) await db.entitlements.put(entitlementRow(row))
  await setStorage(db, { used_bytes: 12_000_000, quota_bytes: 999_000_000, max_file_bytes: 1 })
  const Providers = dataProviders({ db })
  renderWithProviders(
    <Providers>
      <AnalyticsProvider client={analytics}>
        <StoreProvider store={store}>
          <PremiumSheetProvider navigate={() => {}}>
            <FixedNow value={NOW.getTime()}>
              <PlanGroup />
              <SettledProbe />
            </FixedNow>
          </PremiumSheetProvider>
        </StoreProvider>
      </AnalyticsProvider>
    </Providers>,
  )
  return { analytics }
}

const trialRow = (): Partial<LocalEntitlement> => {
  const ends = new Date(NOW.getTime() + 5 * DAY).toISOString()
  return { premium_source: 'trial', premium_expires_at: ends, trial_ends_at: ends }
}
const row = (name: string) => page.getByRole('button', { name, exact: true })

describe('PlanGroup', () => {
  it('shows a trial with its days left', async () => {
    const ends = new Date(NOW.getTime() + 5 * DAY)
    await mount({
      premium_source: 'trial',
      premium_expires_at: ends.toISOString(),
      trial_ends_at: ends.toISOString(),
    })
    await expect.element(page.getByRole('region', { name: PLAN_GROUP })).toBeVisible()
    await expect.element(page.getByText(PLAN_TRIAL, { exact: true })).toBeVisible()
    await expect.element(page.getByText(trialLeft(ends, NOW), { exact: true })).toBeVisible()
  })

  it('shows the free plan with its help and the row quota', async () => {
    await mount({ free_quota_bytes: 50_000_000 })
    await expect.element(page.getByText(PLAN_FREE, { exact: true })).toBeVisible()
    await expect.element(page.getByText(FREE_HELP)).toBeVisible()
    await expect.element(page.getByText(FREE_STORAGE_HELP)).toBeVisible()
    await expect.element(page.getByText('12 MB of 50 MB used')).toBeVisible()
  })

  it('shows a comp with no end as Premium with no detail', async () => {
    await mount({ premium_source: 'comp' })
    await expect.element(page.getByText(PLAN_PREMIUM, { exact: true })).toBeVisible()
    expect(page.getByText(/^Until /).elements()).toHaveLength(0)
    expect(page.getByText(FREE_HELP).elements()).toHaveLength(0)
  })

  it('shows when a comp with an end stops', async () => {
    const ends = new Date(NOW.getTime() + 30 * DAY)
    await mount({ premium_source: 'comp', premium_expires_at: ends.toISOString() })
    await expect.element(page.getByText(premiumUntil(ends), { exact: true })).toBeVisible()
  })

  it('takes a premium quota from the row over the stored server quota', async () => {
    await mount({ premium_source: 'comp', premium_quota_bytes: 5_000_000_000 })
    await expect.element(page.getByText('12 MB of 5 GB used')).toBeVisible()
  })

  it('shows nothing without an entitlements row', async () => {
    await mount()
    await expect.element(page.getByTestId('settled')).toBeVisible()
    expect(page.getByText(PLAN_GROUP).elements()).toHaveLength(0)
    expect(page.getByText(PLAN_FREE, { exact: true }).elements()).toHaveLength(0)
  })

  it.each([
    ['a free account', {}],
    ['a trial', trialRow()],
  ])('opens the Premium sheet from Subscribe for %s', async (_name, entitlement) => {
    const { analytics } = await mount(entitlement)
    await row(SUBSCRIBE).click()
    await expect
      .poll(() => analytics.sends().filter((send) => send.name === 'premium_sheet_shown'))
      .toEqual([{ name: 'premium_sheet_shown', props: { reason: 'plan', from: 'plan_group' } }])
  })

  it('hides Subscribe when no store is configured', async () => {
    await mount({}, null)
    await expect.element(page.getByText(PLAN_FREE, { exact: true })).toBeVisible()
    expect(row(SUBSCRIBE).elements()).toHaveLength(0)
  })

  it('opens the billing portal in a new tab from Manage subscription', async () => {
    config.portalUrl = 'https://billing.example.com/portal'
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await mount({ premium_source: 'stripe' })
    await row(MANAGE_SUBSCRIPTION).click()
    expect(open).toHaveBeenCalledWith('https://billing.example.com/portal', '_blank', 'noopener')
    expect(row(SUBSCRIBE).elements()).toHaveLength(0)
  })

  it('shows no Manage subscription row without a portal URL', async () => {
    await mount({ premium_source: 'stripe' })
    await expect.element(page.getByText(PLAN_PREMIUM, { exact: true })).toBeVisible()
    expect(row(MANAGE_SUBSCRIPTION).elements()).toHaveLength(0)
  })

  it('opens App Store settings from Manage in App Store settings', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await mount({ premium_source: 'apple' })
    await row(MANAGE_APP_STORE).click()
    expect(open).toHaveBeenCalledWith(APP_STORE_SUBSCRIPTIONS_URL, '_blank', 'noopener')
    expect(row(SUBSCRIBE).elements()).toHaveLength(0)
  })

  it('offers a comp neither Subscribe nor Manage', async () => {
    config.portalUrl = 'https://billing.example.com/portal'
    await mount({ premium_source: 'comp' })
    await expect.element(page.getByText(PLAN_PREMIUM, { exact: true })).toBeVisible()
    expect(page.getByRole('button').elements()).toHaveLength(0)
  })
})
