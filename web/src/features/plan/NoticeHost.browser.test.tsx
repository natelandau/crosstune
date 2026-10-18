import { useState, type ReactElement } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { RECORD_LABEL } from '../../layout/tabs'
import { seenNotices } from '../../billing/notices'
import type { Store } from '../../billing/store'
import { StoreProvider } from '../../billing/StoreProvider'
import { useEntitlement } from '../../billing/usePlan'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalEntitlement } from '../../db/types'
import { createSyncEngine } from '../../sync/engine'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { planSheet } from '../../test/planSheet'
import { createFakeApi } from '../../test/fakeApi'
import { fakeMediaForTest } from '../../test/fakeMedia'
import { fakeStore } from '../../test/fakeStore'
import { dataProviders } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import { renderWithProviders } from '../../test/render'
import { renderApp } from '../../test/renderApp'
import { entitlementRow } from '../../test/rows'
import { addedDay } from '../../text/format'
import { Button } from '../../ui/Button'
import { CANCEL, CLOSE } from '../../ui/confirmCopy'
import { Sheet } from '../../ui/Sheet'
import { FixedNow } from '../../ui/useNow'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { noopAnalytics } from '../../usage/client'
import { recordingAnalytics } from '../../usage/testing'
import { NEW_RECORDING, STOP } from '../capture/recordCopy'
import { settingsPagePath } from '../settings/settingsPaths'
import { NoticeHost } from './NoticeHost'
import {
  daysLeft,
  FIRST_RECORDING_TITLE,
  firstRecordingBody,
  LOSE_PLAYBACK,
  LOSE_RECORDING,
  LOSE_SCANS,
  NOTICE_KEEPS,
  NOTICE_OK,
  subscribeAnnual,
  TRIAL_ENDED_TITLE,
  trialReminderTitle,
} from './noticeCopy'
import {
  COMPARE_PLANS,
  PRIVACY_POLICY,
  renewalTerms,
  RENEWS_UNTIL_CANCELLED,
  SEE_PLAN,
  SUBSCRIBE,
  SUBSCRIBED,
  TERMS_OF_USE,
  TRIAL_ENDS_TODAY,
} from './planCopy'
import { PremiumSheetProvider, usePremiumSheet } from './PremiumSheetProvider'
import { useDueNotice } from './useDueNotice'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

const NOW = new Date(2026, 9, 10, 12)
const DAY = 86_400_000

function trialEnding(inMs: number): Partial<LocalEntitlement> {
  const ends = new Date(NOW.getTime() + inMs).toISOString()
  return { premium_source: 'trial', premium_expires_at: ends, trial_ends_at: ends }
}

const dialog = (name: string) => page.getByRole('dialog', { name })

/** Shows the notice the host's inputs make due, once they have all been read, so a test can
 * tell "nothing due" from "not read yet" before it checks that nothing shows. */
function DueProbe() {
  const { kind } = useDueNotice()
  return kind === undefined ? null : <p data-testid="due">{kind ?? 'none'}</p>
}

const due = () => page.getByTestId('due')

const OPEN_PLAN = 'Open plan'

/** Opens the Plan sheet the way Settings does, to see what it shows after a notice. */
function PlanOpener() {
  const premium = usePremiumSheet()
  return <Button label={OPEN_PLAN} onPress={() => premium.open('plan', 'plan_group')} />
}

async function mount(
  db: CrosstuneDb,
  row: Partial<LocalEntitlement>,
  engine?: SyncEngine,
  store: Store | null = null,
) {
  await db.entitlements.put(entitlementRow(row))
  const analytics = recordingAnalytics()
  const navigate = vi.fn()
  const Data = dataProviders({ db, analytics, engine })
  renderWithProviders(
    <Data>
      <StoreProvider store={store}>
        <PremiumSheetProvider>
          <FixedNow value={NOW.getTime()}>
            <NoticeHost navigate={navigate} />
            <DueProbe />
            <PlanOpener />
          </FixedNow>
        </PremiumSheetProvider>
      </StoreProvider>
    </Data>,
  )
  await expect.element(due()).toBeInTheDocument()
  return { analytics, navigate }
}

const shown = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.sends().filter((send) => send.name === 'notice_shown')

it('shows the first-recording notice once the trial holds a recording, and posts it on dismissal', async () => {
  const db = openTestDb()
  const ends = new Date(NOW.getTime() + 10 * DAY).toISOString()
  const fake = createFakeApi()
  const engine = createSyncEngine({
    analytics: noopAnalytics,
    db,
    api: fake.api,
    isOnline: () => true,
  })
  onTestFinished(() => engine.stop())
  const { analytics } = await mount(db, trialEnding(10 * DAY), engine)
  await expect.element(due()).toHaveTextContent('none')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()

  await captureRecording(db)
  const notice = dialog(FIRST_RECORDING_TITLE)
  await expect.element(notice).toBeVisible()
  await expect.element(notice).toHaveAccessibleDescription(firstRecordingBody(addedDay(ends)))
  await expect
    .poll(() => shown(analytics))
    .toEqual([{ name: 'notice_shown', props: { notice: 'first_recording' } }])

  await notice.getByRole('button', { name: NOTICE_OK }).click()
  await expect.element(notice).not.toBeInTheDocument()
  await expect.poll(() => fake.notices).toEqual(['first_recording'])
  await expect.poll(() => shown(analytics)).toHaveLength(1)
})

it('waits for the recorder to close before showing the first-recording notice', async () => {
  fakeMediaForTest()
  const db = openTestDb()
  const ends = new Date(Date.now() + 10 * DAY).toISOString()
  await db.entitlements.put(
    entitlementRow({ premium_source: 'trial', premium_expires_at: ends, trial_ends_at: ends }),
  )
  const analytics = recordingAnalytics()
  const wrap = (app: ReactElement) => (
    <AnalyticsProvider client={analytics}>
      {app}
      <DueProbe />
    </AnalyticsProvider>
  )
  await renderApp({ path: '/catalog', db, frame: { width: 1280, height: 800 }, wrap })
  await page.getByRole('button', { name: RECORD_LABEL }).click()
  const recorder = dialog(NEW_RECORDING)
  await expect.element(recorder.getByRole('timer')).toBeVisible()

  await captureRecording(db)
  await expect.element(due()).toHaveTextContent('first_recording')
  await expect.element(dialog(FIRST_RECORDING_TITLE)).not.toBeInTheDocument()

  await recorder.getByRole('button', { name: STOP }).click()
  await expect.element(recorder).not.toBeInTheDocument()
  await expect.element(dialog(FIRST_RECORDING_TITLE)).toBeVisible()
  await expect
    .poll(() => shown(analytics))
    .toEqual([{ name: 'notice_shown', props: { notice: 'first_recording' } }])
})

it('reminds of a trial ending in two days with what stops and what stays', async () => {
  const db = openTestDb()
  const ends = new Date(NOW.getTime() + 2 * DAY).toISOString()
  const { analytics } = await mount(db, trialEnding(2 * DAY))

  const notice = dialog(trialReminderTitle(addedDay(ends)))
  await expect.element(notice).toBeVisible()
  await expect.element(notice.getByText(daysLeft(2))).toBeVisible()
  for (const line of [LOSE_PLAYBACK, LOSE_RECORDING, LOSE_SCANS, NOTICE_KEEPS]) {
    await expect.element(notice.getByText(line)).toBeVisible()
  }
  await expect
    .poll(() => shown(analytics))
    .toEqual([{ name: 'notice_shown', props: { notice: 'trial_reminder' } }])
})

it('says a trial ending later today ends today', async () => {
  const db = openTestDb()
  const ends = new Date(NOW.getTime() + DAY / 4).toISOString()
  await mount(db, trialEnding(DAY / 4))
  const notice = dialog(trialReminderTitle(addedDay(ends)))
  await expect.element(notice.getByText(TRIAL_ENDS_TODAY, { exact: true })).toBeVisible()
})

it('counts a trial ending tomorrow as one day left', async () => {
  const db = openTestDb()
  const ends = new Date(NOW.getTime() + DAY).toISOString()
  await mount(db, trialEnding(DAY))
  const notice = dialog(trialReminderTitle(addedDay(ends)))
  await expect.element(notice.getByText(daysLeft(1))).toBeVisible()
})

it('shows the next due notice once the first is dismissed', async () => {
  const db = openTestDb()
  await captureRecording(db)
  const ends = new Date(NOW.getTime() + 2 * DAY).toISOString()
  const { analytics } = await mount(db, trialEnding(2 * DAY))

  const reminder = dialog(trialReminderTitle(addedDay(ends)))
  await reminder.getByRole('button', { name: CLOSE }).click()
  await expect.element(reminder).not.toBeInTheDocument()
  await expect.element(dialog(FIRST_RECORDING_TITLE)).toBeVisible()
  await expect
    .poll(() => shown(analytics).map((send) => send.props))
    .toEqual([{ notice: 'trial_reminder' }, { notice: 'first_recording' }])
})

const sheetShown = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.sends().filter((send) => send.name === 'premium_sheet_shown')

const purchaseStarted = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.sends().filter((send) => send.name === 'purchase_started')

const lapsed = (): Partial<LocalEntitlement> => ({
  premium_source: null,
  trial_ends_at: new Date(NOW.getTime() - DAY).toISOString(),
})

const rowFor = (kind: 'trial_reminder' | 'trial_ended') =>
  kind === 'trial_reminder' ? trialEnding(2 * DAY) : lapsed()

it('tells a lapsed trial it has ended and, with no store, offers only Compare plans', async () => {
  const db = openTestDb()
  const { analytics, navigate } = await mount(db, lapsed())

  const notice = dialog(TRIAL_ENDED_TITLE)
  await expect.element(notice).toBeVisible()
  for (const line of [LOSE_PLAYBACK, LOSE_RECORDING, LOSE_SCANS, NOTICE_KEEPS]) {
    await expect.element(notice.getByText(line)).toBeVisible()
  }
  expect(notice.getByText(daysLeft(1)).query()).toBeNull()
  expect(notice.getByRole('button', { name: SUBSCRIBE }).query()).toBeNull()
  expect(notice.getByRole('button', { name: SEE_PLAN }).query()).toBeNull()
  expect(notice.getByRole('button', { name: NOTICE_OK, exact: true }).query()).toBeNull()
  expect(notice.getByText(RENEWS_UNTIL_CANCELLED, { exact: false }).query()).toBeNull()

  await notice.getByRole('button', { name: COMPARE_PLANS }).click()
  await expect.element(notice).not.toBeInTheDocument()
  await expect
    .poll(() => sheetShown(analytics))
    .toEqual([{ name: 'premium_sheet_shown', props: { reason: 'plan', from: 'trial_ended' } }])
  await expect.poll(async () => [...(await seenNotices(db))]).toEqual(['trial_ended'])
  await expect
    .poll(() => shown(analytics))
    .toEqual([{ name: 'notice_shown', props: { notice: 'trial_ended' } }])
  expect(navigate).not.toHaveBeenCalled()
})

it.each(['trial_reminder', 'trial_ended'] as const)(
  'offers Subscribe for the annual price on the %s notice and starts checkout after it closes',
  async (kind) => {
    const db = openTestDb()
    const dialogsAtCheckout: number[] = []
    const store = fakeStore({
      purchase: vi.fn(async () => {
        dialogsAtCheckout.push(document.querySelectorAll('[role="dialog"]').length)
        return 'completed' as const
      }),
    })
    const { analytics, navigate } = await mount(db, rowFor(kind), undefined, store)
    const notice = page.getByRole('dialog').first()
    const subscribe = notice.getByRole('button', { name: subscribeAnnual('$49.99') })
    await expect.element(subscribe).toBeEnabled()
    await expect.element(notice.getByRole('button', { name: COMPARE_PLANS })).toBeVisible()
    await expect.element(notice.getByText(renewalTerms('$49.99', 'annual', true))).toBeVisible()
    await expect.element(notice.getByRole('link', { name: TERMS_OF_USE })).toBeVisible()
    await expect.element(notice.getByRole('link', { name: PRIVACY_POLICY })).toBeVisible()
    expect(notice.getByRole('button', { name: NOTICE_OK, exact: true }).query()).toBeNull()

    await subscribe.click()
    await expect.element(notice).not.toBeInTheDocument()
    await expect.poll(() => store.purchase).toHaveBeenCalledWith('annual')
    expect(dialogsAtCheckout).toEqual([0])
    await expect
      .poll(() => purchaseStarted(analytics))
      .toEqual([{ name: 'purchase_started', props: { period: 'annual', from: kind } }])
    await expect.poll(async () => [...(await seenNotices(db))]).toEqual([kind])
    expect(sheetShown(analytics)).toEqual([])
    expect(navigate).not.toHaveBeenCalled()
  },
)

/** Waits for the sheet to finish moving in, so the boxes inside it read where they rest. */
async function settled(sheet: Element): Promise<void> {
  await expect
    .poll(() => sheet.getBoundingClientRect().width)
    .toBeCloseTo((sheet as HTMLElement).offsetWidth, 0)
}

/** Where an element sits on screen. */
const box = (element: Element) => element.getBoundingClientRect()
const middle = (element: Element) => box(element).left + box(element).width / 2

/** The notice's body, the width its actions match. */
function body(notice: ReturnType<typeof dialog>): Element {
  return document.getElementById(notice.element().getAttribute('aria-describedby') ?? '')!
}

/** Whether the element paints no fill of its own, as text does. */
const unfilled = (element: Element) =>
  getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)'

it('stacks Subscribe, then Compare plans as text, then the renewal and terms lines', async () => {
  // An earlier test can leave the pointer where Compare plans renders, and its hover fills it.
  await userEvent.unhover(document.body)
  const db = openTestDb()
  await mount(db, rowFor('trial_reminder'), undefined, fakeStore())
  const notice = page.getByRole('dialog').first()
  const subscribe = notice.getByRole('button', { name: subscribeAnnual('$49.99') })
  await expect.element(subscribe).toBeEnabled()
  await settled(notice.element())

  const lead = subscribe.element()
  const compare = notice.getByRole('button', { name: COMPARE_PLANS }).element()
  const renews = notice.getByText(renewalTerms('$49.99', 'annual', true)).element()
  const terms = notice.getByRole('link', { name: TERMS_OF_USE }).element()
  const stack = [lead, compare, renews, terms]
  for (let i = 1; i < stack.length; i++) {
    expect(box(stack[i - 1]!).bottom).toBeLessThanOrEqual(box(stack[i]!).top)
  }
  await expect.poll(() => box(lead).width - box(body(notice)).width).toBeCloseTo(0, 0)
  expect(box(lead).height).toBeGreaterThan(box(compare).height)
  // Fills ease between states, so each is read until it settles.
  await expect.poll(() => unfilled(lead)).toBe(false)
  await expect.poll(() => unfilled(compare)).toBe(true)
  for (const element of [compare, renews, terms.parentElement!]) {
    expect(Math.abs(middle(element) - middle(lead))).toBeLessThanOrEqual(1)
  }
})

it('leads with Compare plans as the full-width primary when the notice cannot sell', async () => {
  const db = openTestDb()
  await mount(db, lapsed())
  const notice = dialog(TRIAL_ENDED_TITLE)
  const compare = notice.getByRole('button', { name: COMPARE_PLANS })
  await expect.element(compare).toBeVisible()
  await settled(notice.element())

  await expect.poll(() => box(compare.element()).width - box(body(notice)).width).toBeCloseTo(0, 0)
  expect(unfilled(compare.element())).toBe(false)
  const others = notice
    .getByRole('button')
    .elements()
    .filter((button) => button !== compare.element() && !button.closest('header'))
  expect(others).toEqual([])
})

it("holds Subscribe's place full width, over Compare plans, while the offers have not answered", async () => {
  const db = openTestDb()
  await mount(
    db,
    rowFor('trial_reminder'),
    undefined,
    fakeStore({ offers: () => new Promise(() => {}) }),
  )
  const notice = page.getByRole('dialog').first()
  const placeholder = notice.getByRole('button', { name: SUBSCRIBE })
  await expect.element(placeholder).toBeDisabled()
  await settled(notice.element())

  const compare = notice.getByRole('button', { name: COMPARE_PLANS }).element()
  await expect
    .poll(() => box(placeholder.element()).width - box(body(notice)).width)
    .toBeCloseTo(0, 0)
  expect(box(placeholder.element()).bottom).toBeLessThanOrEqual(box(compare).top)
  expect(unfilled(compare)).toBe(true)
})

it('a cancelled checkout from a notice leaves nothing open', async () => {
  const db = openTestDb()
  const store = fakeStore({ purchase: vi.fn(async () => 'cancelled' as const) })
  await mount(db, rowFor('trial_ended'), undefined, store)
  const notice = dialog(TRIAL_ENDED_TITLE)
  await notice.getByRole('button', { name: subscribeAnnual('$49.99') }).click()

  await expect.poll(() => store.purchase).toHaveBeenCalledTimes(1)
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  await expect.poll(async () => [...(await seenNotices(db))]).toEqual(['trial_ended'])
})

it('a purchase from a notice settles the Plan sheet before the plan follows', async () => {
  const db = openTestDb()
  await mount(db, rowFor('trial_reminder'), undefined, fakeStore())
  const notice = page.getByRole('dialog').first()
  await notice.getByRole('button', { name: subscribeAnnual('$49.99') }).click()
  await expect.element(notice).not.toBeInTheDocument()

  await expect.poll(() => page.getByRole('status').getByText(SUBSCRIBED).query()).not.toBeNull()
  await page.getByRole('button', { name: OPEN_PLAN }).click()
  const plan = planSheet()
  await expect.element(plan.getByText(SUBSCRIBED, { exact: true })).toBeVisible()
  expect(plan.getByRole('button', { name: SUBSCRIBE }).query()).toBeNull()
})

it('holds the next due notice until the checkout from a notice has finished', async () => {
  const db = openTestDb()
  await captureRecording(db)
  let finish: (outcome: 'completed' | 'cancelled') => void = () => {}
  const store = fakeStore({
    purchase: vi.fn(() => new Promise<'completed' | 'cancelled'>((done) => (finish = done))),
  })
  await mount(db, rowFor('trial_reminder'), undefined, store)
  const reminder = page.getByRole('dialog').first()
  await reminder.getByRole('button', { name: subscribeAnnual('$49.99') }).click()

  await expect.poll(() => store.purchase).toHaveBeenCalledTimes(1)
  await expect.element(due()).toHaveTextContent('first_recording')
  await expect.element(dialog(FIRST_RECORDING_TITLE)).not.toBeInTheDocument()

  finish('cancelled')
  await expect.element(dialog(FIRST_RECORDING_TITLE)).toBeVisible()
})

it("holds the next due notice while the Plan sheet's own checkout is open", async () => {
  const db = openTestDb()
  await captureRecording(db)
  let finish: (outcome: 'completed' | 'cancelled') => void = () => {}
  const store = fakeStore({
    purchase: vi.fn(() => new Promise<'completed' | 'cancelled'>((done) => (finish = done))),
  })
  await mount(db, rowFor('trial_reminder'), undefined, store)
  await page.getByRole('dialog').first().getByRole('button', { name: COMPARE_PLANS }).click()
  const plan = planSheet()
  await plan.getByRole('button', { name: SUBSCRIBE }).click()

  await expect.element(plan).not.toBeInTheDocument()
  await expect.poll(() => store.purchase).toHaveBeenCalledWith('annual')
  await expect.element(due()).toHaveTextContent('first_recording')
  await expect.element(dialog(FIRST_RECORDING_TITLE)).not.toBeInTheDocument()

  finish('cancelled')
  await expect.element(dialog(FIRST_RECORDING_TITLE)).toBeVisible()
})

it("holds Subscribe's place, off, beside Compare plans while the offers have not answered", async () => {
  const db = openTestDb()
  const store = fakeStore({ offers: () => new Promise(() => {}) })
  await mount(db, rowFor('trial_reminder'), undefined, store)
  const notice = page.getByRole('dialog').first()
  await expect.element(notice.getByRole('button', { name: SUBSCRIBE })).toBeDisabled()
  await expect.element(notice.getByRole('button', { name: COMPARE_PLANS })).toBeEnabled()
  expect(notice.getByText(RENEWS_UNTIL_CANCELLED, { exact: false }).query()).toBeNull()
})

it("holds Subscribe's place, off, while the plan reads unknown under an open notice", async () => {
  const db = openTestDb()
  const row = rowFor('trial_reminder')
  await mount(db, row, undefined, fakeStore())
  const notice = page.getByRole('dialog').first()
  const priced = notice.getByRole('button', { name: subscribeAnnual('$49.99') })
  await expect.element(priced).toBeEnabled()

  // No row reads as an unknown plan, which can neither sell nor rule selling out.
  await db.entitlements.clear()
  await expect.element(notice.getByRole('button', { name: SUBSCRIBE, exact: true })).toBeDisabled()
  await expect.element(notice.getByRole('button', { name: COMPARE_PLANS })).toBeEnabled()
  expect(priced.query()).toBeNull()

  await db.entitlements.put(entitlementRow(row))
  await expect.element(priced).toBeEnabled()
})

it.each([
  ['the offers fail', fakeStore({ offers: () => Promise.reject(new Error('unreachable')) })],
  [
    'the store sells only Monthly',
    fakeStore({
      offers: async () => [{ period: 'monthly', price: '$4.99', amountMicros: 4_990_000 }],
    }),
  ],
  ['the browser is offline', fakeStore()],
])('leads with Compare plans alone when %s', async (situation, store) => {
  if (situation === 'the browser is offline') {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  }
  const db = openTestDb()
  await mount(db, rowFor('trial_reminder'), undefined, store)
  const notice = page.getByRole('dialog').first()
  await expect.element(notice.getByRole('button', { name: COMPARE_PLANS })).toBeEnabled()
  await expect.element(notice.getByRole('button', { name: CLOSE })).toBeVisible()
  // The store's answer settles the actions, so the off Subscribe that held its place has gone.
  await expect.element(notice.getByRole('button', { name: SUBSCRIBE })).not.toBeInTheDocument()
  expect(notice.getByText(RENEWS_UNTIL_CANCELLED, { exact: false }).query()).toBeNull()
})

it('opens the Plan sheet from Compare plans', async () => {
  const db = openTestDb()
  const store = fakeStore({ purchase: vi.fn(async () => 'completed' as const) })
  const { analytics } = await mount(db, rowFor('trial_reminder'), undefined, store)
  const notice = page.getByRole('dialog').first()
  await notice.getByRole('button', { name: COMPARE_PLANS }).click()

  await expect.element(planSheet()).toBeVisible()
  await expect
    .poll(() => sheetShown(analytics))
    .toEqual([{ name: 'premium_sheet_shown', props: { reason: 'plan', from: 'trial_reminder' } }])
  await expect.poll(async () => [...(await seenNotices(db))]).toEqual(['trial_reminder'])
  expect(store.purchase).not.toHaveBeenCalled()
})

it('keeps OK and See your plan on the first-recording notice even with a store', async () => {
  const db = openTestDb()
  await captureRecording(db)
  const { navigate } = await mount(db, trialEnding(10 * DAY), undefined, fakeStore())
  const notice = dialog(FIRST_RECORDING_TITLE)
  await expect.element(notice.getByRole('button', { name: NOTICE_OK, exact: true })).toBeVisible()
  expect(notice.getByRole('button', { name: SUBSCRIBE }).query()).toBeNull()
  expect(notice.getByRole('button', { name: COMPARE_PLANS }).query()).toBeNull()

  await notice.getByRole('button', { name: SEE_PLAN }).click()
  await expect.element(notice).not.toBeInTheDocument()
  expect(navigate).toHaveBeenCalledWith(settingsPagePath('account'))
})

it('takes Escape as a dismissal', async () => {
  const db = openTestDb()
  await mount(db, lapsed())
  await expect.element(dialog(TRIAL_ENDED_TITLE)).toBeVisible()

  await userEvent.keyboard('{Escape}')
  await expect.element(dialog(TRIAL_ENDED_TITLE)).not.toBeInTheDocument()
  await expect.poll(async () => [...(await seenNotices(db))]).toEqual(['trial_ended'])
})

it('shows nothing to a comp account whose trial ended', async () => {
  const db = openTestDb()
  await captureRecording(db)
  const { analytics } = await mount(db, {
    premium_source: 'comp',
    trial_ends_at: new Date(NOW.getTime() - DAY).toISOString(),
  })
  await expect.element(due()).toHaveTextContent('none')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(shown(analytics)).toEqual([])
})

it('shows nothing once the account has seen the trial end', async () => {
  const db = openTestDb()
  const { analytics } = await mount(db, {
    premium_source: null,
    trial_ends_at: new Date(NOW.getTime() - DAY).toISOString(),
    trial_end_seen_at: new Date(NOW.getTime() - DAY / 2).toISOString(),
  })
  await expect.element(due()).toHaveTextContent('none')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
  expect(shown(analytics)).toEqual([])
})

it('shows nothing while the entitlements read fails', async () => {
  const db = openTestDb()
  vi.spyOn(db.entitlements, 'filter').mockReturnValue({
    first: () => Promise.reject(new Error('read failed')),
  } as unknown as ReturnType<typeof db.entitlements.filter>)
  const Data = dataProviders({ db })
  renderWithProviders(
    <Data>
      <NoticeHost navigate={() => {}} />
      <DueProbe />
    </Data>,
  )
  await expect.poll(() => useEntitlement.sharedFor(db).get().failure).toBeDefined()
  await expect.element(due()).toHaveTextContent('none')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it('shows nothing while the recordings read fails', async () => {
  const db = openTestDb()
  vi.spyOn(db.recordings, 'filter').mockReturnValue({
    first: () => Promise.reject(new Error('read failed')),
  } as unknown as ReturnType<typeof db.recordings.filter>)
  await mount(db, trialEnding(10 * DAY))
  await expect.element(due()).toHaveTextContent('none')
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

/** Moves the fixed clock into the reminder window and opens another sheet in one update, so the
 * reminder falls due in the very commit the other sheet opens. */
function SameCommit({ navigate }: { navigate: (to: string) => void }) {
  const [now, setNow] = useState(NOW.getTime())
  const [open, setOpen] = useState(false)
  return (
    <FixedNow value={now}>
      <Button
        label="Advance"
        onPress={() => {
          setNow(NOW.getTime() + 2.5 * DAY)
          setOpen(true)
        }}
      />
      <Sheet isOpen={open} onOpenChange={setOpen} title="Other">
        <p>Other</p>
      </Sheet>
      <NoticeHost navigate={navigate} />
      <DueProbe />
    </FixedNow>
  )
}

it('waits for a sheet that opened in the same commit the notice fell due', async () => {
  const db = openTestDb()
  await db.entitlements.put(entitlementRow(trialEnding(5 * DAY)))
  const Data = dataProviders({ db })
  renderWithProviders(
    <Data>
      <SameCommit navigate={() => {}} />
    </Data>,
  )
  await expect.element(due()).toHaveTextContent('none')
  await page.getByRole('button', { name: 'Advance' }).click()

  const other = dialog('Other')
  await expect.element(other).toBeVisible()
  await expect.element(due()).toHaveTextContent('trial_reminder')
  const reminder = dialog(
    trialReminderTitle(addedDay(new Date(NOW.getTime() + 5 * DAY).toISOString())),
  )
  await expect.element(reminder).not.toBeInTheDocument()

  await other.getByRole('button', { name: CANCEL }).click()
  await expect.element(reminder).toBeVisible()
})

function PremiumOpener({ onPress }: { onPress: () => void }) {
  const premium = usePremiumSheet()
  return (
    <Button
      label="Advance"
      onPress={() => {
        onPress()
        premium.open('recordings', 'record')
      }}
    />
  )
}

/** As the app nests them: the Plan sheet renders after its children, so its claim registers
 * after the host's layout effects in a commit they share. */
function SameCommitPremium() {
  const [now, setNow] = useState(NOW.getTime())
  return (
    <FixedNow value={now}>
      <PremiumSheetProvider>
        <PremiumOpener onPress={() => setNow(NOW.getTime() + 2.5 * DAY)} />
        <NoticeHost navigate={() => {}} />
        <DueProbe />
      </PremiumSheetProvider>
    </FixedNow>
  )
}

it('waits for a Plan sheet that opened in the same commit the notice fell due', async () => {
  const db = openTestDb()
  await db.entitlements.put(entitlementRow(trialEnding(5 * DAY)))
  const Data = dataProviders({ db })
  renderWithProviders(
    <Data>
      <SameCommitPremium />
    </Data>,
  )
  await expect.element(due()).toHaveTextContent('none')
  await page.getByRole('button', { name: 'Advance' }).click()

  const premium = planSheet()
  await expect.element(premium).toBeVisible()
  await expect.element(due()).toHaveTextContent('trial_reminder')
  const reminder = dialog(
    trialReminderTitle(addedDay(new Date(NOW.getTime() + 5 * DAY).toISOString())),
  )
  await expect.element(reminder).not.toBeInTheDocument()

  // No store sells here, so the sheet closes from its header.
  await premium.getByRole('button', { name: CLOSE }).click()
  await expect.element(reminder).toBeVisible()
})
