import { expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { LocalEntitlement } from '../../db/types'
import { openTestDb } from '../../test/db'
import { dataProviders, fakeEngine } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { entitlementRow } from '../../test/rows'
import type { SyncEngine } from '../../sync/types'
import { CANCEL } from '../../ui/confirmCopy'
import { FixedNow } from '../../ui/useNow'
import { planSheet } from '../../test/planSheet'
import { PlanSheet } from './PlanSheet'
import {
  ON_PREMIUM,
  WITHDRAW_CONFIRM_BODY,
  WITHDRAW_CONFIRM_TITLE,
  WITHDRAW_DONE,
  WITHDRAW_FAILED,
  WITHDRAW_LABEL,
  WITHDRAW_ALREADY,
  WITHDRAW_REFUSED,
  WITHDRAW_WINDOW_CLOSED,
  withdrawUntil,
} from './planCopy'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

const DAY = 86_400_000
const NOW = Date.parse('2026-10-10T12:00:00.000Z')
const RENEWAL = new Date(NOW + 300 * DAY).toISOString()
const OPEN: Partial<LocalEntitlement> = {
  premium_source: 'stripe',
  premium_expires_at: RENEWAL,
  auto_renews: true,
  withdraw_until: new Date(NOW + 5 * DAY).toISOString(),
}

const withdrawRow = () => planSheet().getByRole('button', { name: WITHDRAW_LABEL, exact: true })
const confirmButton = () => page.getByRole('button', { name: 'Withdraw', exact: true })

async function showPlan(row: Partial<LocalEntitlement>, engine: SyncEngine = fakeEngine()) {
  const db = openTestDb()
  await db.entitlements.put(entitlementRow(row))
  const Data = dataProviders({ db, engine })
  renderWithProviders(
    <Data>
      <FixedNow value={NOW}>
        <PlanSheet
          open
          reason="plan"
          settled={false}
          onClose={() => {}}
          onClosed={() => {}}
          onSubscribe={() => {}}
        />
      </FixedNow>
    </Data>,
  )
  await expect.element(planSheet().getByRole('heading', { name: ON_PREMIUM })).toBeVisible()
}

it.each([
  ['has no withdrawal window', { ...OPEN, withdraw_until: null }],
  ['has a window that has closed', { ...OPEN, withdraw_until: new Date(NOW - DAY).toISOString() }],
  ['is an App Store plan', { ...OPEN, premium_source: 'apple' as const }],
])('hides the row when the account %s', async (_name, row) => {
  await showPlan(row)
  await expect.element(withdrawRow()).not.toBeInTheDocument()
})

it('shows the row and the last day of the window', async () => {
  await showPlan(OPEN)
  await expect.element(withdrawRow()).toBeVisible()
  await expect
    .element(planSheet().getByText(withdrawUntil(new Date(OPEN.withdraw_until!))))
    .toBeVisible()
})

it('withdraws once after confirming, then says it is done', async () => {
  const withdraw = vi.fn(async () => 'withdrawn' as const)
  await showPlan(OPEN, fakeEngine({ withdraw }))
  await withdrawRow().click()
  await expect.element(page.getByText(WITHDRAW_CONFIRM_TITLE)).toBeVisible()
  await expect.element(page.getByText(WITHDRAW_CONFIRM_BODY)).toBeVisible()
  expect(withdraw).not.toHaveBeenCalled()
  await confirmButton().click()

  await expect.element(page.getByText(WITHDRAW_DONE)).toBeVisible()
  expect(withdraw).toHaveBeenCalledTimes(1)
})

it('stays off after a refund, so a second press asks nothing', async () => {
  const withdraw = vi.fn(async () => 'withdrawn' as const)
  await showPlan(OPEN, fakeEngine({ withdraw }))
  await withdrawRow().click()
  await confirmButton().click()
  await expect.element(page.getByText(WITHDRAW_DONE)).toBeVisible()

  await expect.element(withdrawRow()).toBeDisabled()
  await expect.element(page.getByText(WITHDRAW_CONFIRM_TITLE)).not.toBeInTheDocument()
  expect(withdraw).toHaveBeenCalledTimes(1)
})

it('describes the button by the last day', async () => {
  await showPlan(OPEN)
  await expect
    .element(withdrawRow())
    .toHaveAccessibleDescription(withdrawUntil(new Date(OPEN.withdraw_until!)))
})

it('hides the row once the clock passes the end of the window', async () => {
  const db = openTestDb()
  await db.entitlements.put(entitlementRow(OPEN))
  const Data = dataProviders({ db, engine: fakeEngine() })
  const sheet = (now: number) => (
    <Data>
      <FixedNow value={now}>
        <PlanSheet
          open
          reason="plan"
          settled={false}
          onClose={() => {}}
          onClosed={() => {}}
          onSubscribe={() => {}}
        />
      </FixedNow>
    </Data>
  )
  const { rerender } = renderWithProviders(sheet(NOW))
  await expect.element(withdrawRow()).toBeVisible()

  await rerender(sheet(Date.parse(OPEN.withdraw_until!)))
  await expect.element(withdrawRow()).not.toBeInTheDocument()
})

it('hides the row at the end of the window on the real clock, before the next minute', async () => {
  const end = NOW + 30_000
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'Date'],
    now: NOW,
  })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const db = openTestDb()
  await db.entitlements.put(
    entitlementRow({ ...OPEN, withdraw_until: new Date(end).toISOString() }),
  )
  const Data = dataProviders({ db, engine: fakeEngine() })
  renderWithProviders(
    <Data>
      <PlanSheet
        open
        reason="plan"
        settled={false}
        onClose={() => {}}
        onClosed={() => {}}
        onSubscribe={() => {}}
      />
    </Data>,
  )
  // The database and the sheet wait on timers too, so the fake clock moves while it renders.
  await expect
    .poll(async () => {
      await vi.advanceTimersByTimeAsync(10)
      return withdrawRow().query() !== null
    })
    .toBe(true)

  await vi.advanceTimersByTimeAsync(end - Date.now() - 1)
  await expect.element(withdrawRow()).toBeVisible()
  await vi.advanceTimersByTimeAsync(1)
  await expect.element(withdrawRow()).not.toBeInTheDocument()
})

it('does not withdraw when the confirmation is cancelled', async () => {
  const withdraw = vi.fn(async () => 'withdrawn' as const)
  await showPlan(OPEN, fakeEngine({ withdraw }))
  await withdrawRow().click()
  await page.getByRole('button', { name: CANCEL }).click()

  await expect.element(page.getByText(WITHDRAW_CONFIRM_TITLE)).not.toBeInTheDocument()
  expect(withdraw).not.toHaveBeenCalled()
  await expect.element(page.getByText(WITHDRAW_DONE)).not.toBeInTheDocument()
})

it.each([
  ['refused', WITHDRAW_REFUSED],
  ['window_closed', WITHDRAW_WINDOW_CLOSED],
  ['already_withdrawn', WITHDRAW_ALREADY],
  ['failed', WITHDRAW_FAILED],
] as const)('says so when the withdrawal is %s', async (outcome, line) => {
  await showPlan(OPEN, fakeEngine({ withdraw: async () => outcome }))
  await withdrawRow().click()
  await confirmButton().click()

  await expect.element(planSheet().getByRole('alert')).toHaveTextContent(line)
  await expect.element(page.getByText(WITHDRAW_DONE)).not.toBeInTheDocument()
  await expect.element(withdrawRow()).toBeEnabled()
})
