import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { useEntitlement } from '../../billing/usePlan'
import { setStorage } from '../../db/meta'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalEntitlement } from '../../db/types'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { entitlementRow } from '../../test/rows'
import { FixedNow } from '../../ui/useNow'
import {
  FREE_HELP,
  FREE_STORAGE_HELP,
  PLAN_FREE,
  PLAN_GROUP,
  PLAN_PREMIUM,
  PLAN_TRIAL,
  premiumUntil,
  trialLeft,
} from '../plan/planCopy'
import { PlanGroup } from './PlanGroup'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const NOW = new Date(2026, 9, 10, 12)
const DAY = 86_400_000

/** Shows once the entitlements read has answered, so a test can tell "no row" from "not read yet". */
function SettledProbe() {
  return useEntitlement() === undefined ? null : <p data-testid="settled">settled</p>
}

async function mount(row?: Partial<LocalEntitlement>) {
  if (row) await db.entitlements.put(entitlementRow(row))
  await setStorage(db, { used_bytes: 12_000_000, quota_bytes: 999_000_000, max_file_bytes: 1 })
  const Providers = dataProviders({ db })
  return render(
    <Providers>
      <FixedNow value={NOW.getTime()}>
        <PlanGroup />
        <SettledProbe />
      </FixedNow>
    </Providers>,
  )
}

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
})
