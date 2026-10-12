import { useEffect, type ReactElement } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import { RECORD_LABEL } from '../../app/tabs'
import { destination } from '../../app/destinations'
import type { Store } from '../../billing/store'
import { StoreProvider } from '../../billing/StoreProvider'
import { useEntitlement, usePlan } from '../../billing/usePlan'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalEntitlement } from '../../db/types'
import { openTestDb } from '../../test/db'
import { fakeMediaForTest } from '../../test/fakeMedia'
import { fakeStore } from '../../test/fakeStore'
import { renderApp } from '../../test/renderApp'
import { dataProviders, fakeEngine } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { entitlementRow, scanRow, tuneRow } from '../../test/rows'
import type { SyncEngine } from '../../sync/types'
import { Button } from '../../ui/Button'
import { FixedNow } from '../../ui/useNow'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import type { PremiumEntry, PremiumReason } from '../../usage/events'
import { recordingAnalytics } from '../../usage/testing'
import { NEW_RECORDING } from '../capture/recordCopy'
import { SEARCH_RECORDINGS, UPLOAD_AUDIO } from '../recordings/recordingsCopy'
import { ADD_RECORDING } from '../tune/tuneMediaCopy'
import { TUNE } from '../tune/tunePageCopy'
import {
  annualPrice,
  BILLING_PERIOD,
  monthlyPrice,
  PERIOD_ANNUAL,
  PERIOD_MONTHLY,
  PLAN_GROUP,
  PREMIUM_PLAN_BODY,
  PREMIUM_PLAN_TITLE,
  PREMIUM_RECORDINGS_BODY,
  PREMIUM_RECORDINGS_TITLE,
  PREMIUM_SCANS_TITLE,
  premiumScansBody,
  RENEWS_UNTIL_CANCELLED,
  SEE_PLAN,
  SUBSCRIBE,
  SUBSCRIBE_FAILED,
  SUBSCRIBE_OFFLINE,
  SUBSCRIBED,
} from './planCopy'
import {
  PremiumSheetProvider,
  usePremiumSheet,
  type PremiumSheetLauncher,
} from './PremiumSheetProvider'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

const WIDE = { width: 1280, height: 800 }
const DAY = 86_400_000
const FREE: Partial<LocalEntitlement> = {}
const TRIAL = (): Partial<LocalEntitlement> => {
  const ends = new Date(Date.now() + 10 * DAY).toISOString()
  return { premium_source: 'trial', premium_expires_at: ends, trial_ends_at: ends }
}

const premiumSheet = () => page.getByRole('dialog', { name: PREMIUM_RECORDINGS_TITLE })
const recordSheet = () => page.getByRole('dialog', { name: NEW_RECORDING })

/** Shows the plan the app reads, so a test acts only once the stored row is judged. */
function PlanProbe() {
  return <p data-testid="plan">{usePlan().kind}</p>
}

async function mount(db: CrosstuneDb, path: string, row: Partial<LocalEntitlement>) {
  await db.entitlements.put(entitlementRow(row))
  const analytics = recordingAnalytics()
  const wrap = (app: ReactElement) => (
    <AnalyticsProvider client={analytics}>
      {app}
      <PlanProbe />
    </AnalyticsProvider>
  )
  const rendered = await renderApp({ path, db, frame: WIDE, wrap })
  const kind = row.premium_source ? 'premium' : 'free'
  await expect.element(page.getByTestId('plan')).toHaveTextContent(kind)
  return { ...rendered, analytics }
}

const shown = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.sends().filter((send) => send.name === 'premium_sheet_shown')

it('answers Record on a free plan with the Premium sheet, not the recorder', async () => {
  fakeMediaForTest()
  const { analytics } = await mount(openTestDb(), '/catalog', FREE)
  await page.getByRole('button', { name: RECORD_LABEL }).click()

  await expect.element(premiumSheet()).toBeVisible()
  await expect.element(premiumSheet().getByText(PREMIUM_RECORDINGS_BODY)).toBeVisible()
  await expect.element(recordSheet()).not.toBeInTheDocument()
  await expect
    .poll(() => analytics.sends())
    .toEqual([{ name: 'premium_sheet_shown', props: { reason: 'recordings', from: 'record' } }])
})

it('opens the Plan group in Settings from See your plan', async () => {
  const { router } = await mount(openTestDb(), '/catalog', FREE)
  await page.getByRole('button', { name: RECORD_LABEL }).click()
  await premiumSheet().getByRole('button', { name: SEE_PLAN }).click()

  await expect.poll(() => router.state.location.pathname).toBe('/settings/account')
  await expect.element(page.getByRole('region', { name: PLAN_GROUP })).toBeVisible()
  await expect.element(premiumSheet()).not.toBeInTheDocument()
})

it('opens the recorder from Record during a trial', async () => {
  fakeMediaForTest()
  const { analytics } = await mount(openTestDb(), '/catalog', TRIAL())
  await page.getByRole('button', { name: RECORD_LABEL }).click()

  await expect.element(recordSheet()).toBeVisible()
  await expect.element(premiumSheet()).not.toBeInTheDocument()
  expect(shown(analytics)).toEqual([])
})

it("answers New recording in a tune's Add menu with the Premium sheet on a free plan", async () => {
  fakeMediaForTest()
  const db = openTestDb()
  const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
  const { analytics } = await mount(db, `/catalog/${tuneId}`, FREE)
  await page.getByRole('main', { name: TUNE }).getByRole('button', { name: ADD_RECORDING }).click()
  await page.getByRole('menuitem', { name: NEW_RECORDING }).click()

  await expect.element(premiumSheet()).toBeVisible()
  await expect.element(recordSheet()).not.toBeInTheDocument()
  await expect
    .poll(() => shown(analytics))
    .toEqual([{ name: 'premium_sheet_shown', props: { reason: 'recordings', from: 'record' } }])
})

/** Fires a file drop on the Recordings column, as a drag from the desktop would. */
function drop(files: File[]) {
  const dataTransfer = new DataTransfer()
  for (const file of files) dataTransfer.items.add(file)
  page
    .getByRole('searchbox', { name: SEARCH_RECORDINGS })
    .element()
    .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
}

it('answers a dropped audio file on a free plan with the Premium sheet, adding nothing', async () => {
  const db = openTestDb()
  const { analytics } = await mount(db, destination('recordings').root, FREE)
  await expect.element(page.getByRole('searchbox', { name: SEARCH_RECORDINGS })).toBeVisible()
  drop([new File(['abc'], 'jam.m4a', { type: 'audio/mp4' })])

  await expect.element(premiumSheet()).toBeVisible()
  await expect
    .poll(() => shown(analytics))
    .toEqual([{ name: 'premium_sheet_shown', props: { reason: 'recordings', from: 'upload' } }])
  expect(await db.recordings.count()).toBe(0)
  expect(analytics.sends().filter((send) => send.name === 'audio_imported')).toEqual([])
})

it('answers Upload on a free plan with the Premium sheet', async () => {
  const { analytics } = await mount(openTestDb(), destination('recordings').root, FREE)
  await page.getByRole('button', { name: UPLOAD_AUDIO }).click()

  await expect.element(premiumSheet()).toBeVisible()
  await expect
    .poll(() => shown(analytics))
    .toEqual([{ name: 'premium_sheet_shown', props: { reason: 'recordings', from: 'upload' } }])
})

it('imports a dropped audio file during a trial', async () => {
  const db = openTestDb()
  await mount(db, destination('recordings').root, TRIAL())
  await expect.element(page.getByRole('searchbox', { name: SEARCH_RECORDINGS })).toBeVisible()
  drop([new File(['abc'], 'jam.m4a', { type: 'audio/mp4' })])

  await expect.poll(() => db.recordings.count()).toBe(1)
  await expect.element(premiumSheet()).not.toBeInTheDocument()
})

it('opens the recorder from Record while the entitlements read fails', async () => {
  fakeMediaForTest()
  const db = openTestDb()
  vi.spyOn(db.entitlements, 'filter').mockReturnValue({
    first: () => Promise.reject(new Error('read failed')),
  } as unknown as ReturnType<typeof db.entitlements.filter>)
  await renderApp({ path: '/catalog', db, frame: WIDE })
  await expect.poll(() => useEntitlement.sharedFor(db).get().failure).toBeDefined()
  await page.getByRole('button', { name: RECORD_LABEL }).click()

  await expect.element(recordSheet()).toBeVisible()
  await expect.element(premiumSheet()).not.toBeInTheDocument()
})

function ScansOpener() {
  const premium = usePremiumSheet()
  return <Button label="Open scans" onPress={() => premium.open('scans', 'scan')} />
}

it("opens the scans sheet already describing the scan tune's title", async () => {
  const db = openTestDb()
  await db.tunes.put(tuneRow('tune-1', 'Forked Deer'))
  await db.scans.put(scanRow('scan-1', 'tune-1'))
  const analytics = recordingAnalytics()
  const Data = dataProviders({ db, analytics })
  // Records every description the dialog shows, so a sheet that opened before its body fails.
  const descriptions: (string | null)[] = []
  const observer = new MutationObserver(() => {
    const dialog = document.querySelector('[role="dialog"]')
    if (dialog) descriptions.push(dialog.getAttribute('aria-describedby'))
  })
  observer.observe(document.body, { subtree: true, childList: true, attributes: true })
  onTestFinished(() => observer.disconnect())
  renderWithProviders(
    <Data>
      <PremiumSheetProvider navigate={() => {}}>
        <ScansOpener />
      </PremiumSheetProvider>
    </Data>,
  )
  await page.getByRole('button', { name: 'Open scans' }).click()

  const dialog = page.getByRole('dialog', { name: PREMIUM_SCANS_TITLE })
  await expect.element(dialog).toHaveAccessibleDescription(premiumScansBody('Forked Deer'))
  expect(descriptions).not.toContain(null)
  expect(analytics.sends()).toEqual([
    { name: 'premium_sheet_shown', props: { reason: 'scans', from: 'scan' } },
  ])
})

const NOW = Date.parse('2026-10-10T12:00:00.000Z')
const PAYWALL_TRIAL: Partial<LocalEntitlement> = {
  premium_source: 'trial',
  premium_expires_at: new Date(NOW + 10 * DAY).toISOString(),
  trial_ends_at: new Date(NOW + 10 * DAY).toISOString(),
}

function Opener({ reason, from }: { reason: PremiumReason; from: PremiumEntry }) {
  const premium = usePremiumSheet()
  return <Button label="Open Premium" onPress={() => premium.open(reason, from)} />
}

/** Hands out the sheet's launcher, so a test can open the sheet at a moment no tap could. */
function HoldLauncher({ onLauncher }: { onLauncher: (launcher: PremiumSheetLauncher) => void }) {
  const launcher = usePremiumSheet()
  useEffect(() => onLauncher(launcher), [launcher, onLauncher])
  return null
}

/** Mounts the Premium sheet over a seeded plan and store, and opens it once the plan is judged. */
async function openPaywall({
  row = FREE,
  store = fakeStore(),
  engine = fakeEngine(),
  reason = 'recordings',
  from = 'record',
}: {
  row?: Partial<LocalEntitlement>
  store?: Store | null
  engine?: SyncEngine
  reason?: PremiumReason
  from?: PremiumEntry
} = {}) {
  const db = openTestDb()
  await db.entitlements.put(entitlementRow(row))
  const analytics = recordingAnalytics()
  const Data = dataProviders({ db, analytics, engine })
  const held: { launcher?: PremiumSheetLauncher } = {}
  renderWithProviders(
    <Data>
      <FixedNow value={NOW}>
        <StoreProvider store={store}>
          <PremiumSheetProvider navigate={() => {}}>
            <Opener reason={reason} from={from} />
            <HoldLauncher
              onLauncher={(launcher) => {
                held.launcher = launcher
              }}
            />
            <PlanProbe />
          </PremiumSheetProvider>
        </StoreProvider>
      </FixedNow>
    </Data>,
  )
  await expect
    .element(page.getByTestId('plan'))
    .toHaveTextContent(row.premium_source ? 'premium' : 'free')
  await page.getByRole('button', { name: 'Open Premium' }).click()
  return { analytics, launcher: () => held.launcher! }
}

const purchaseSends = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.sends().filter((send) => send.name.startsWith('purchase_'))

const annual = () => premiumSheet().getByRole('radio', { name: PERIOD_ANNUAL, exact: true })
const monthly = () => premiumSheet().getByRole('radio', { name: PERIOD_MONTHLY, exact: true })

it('free account sees annual selected with its price and Subscribe', async () => {
  await openPaywall()

  await expect.element(annual()).toBeChecked()
  await expect.element(annual()).toHaveAccessibleDescription(annualPrice('$49.99'))
  await expect.element(monthly()).not.toBeChecked()
  await expect.element(monthly()).toHaveAccessibleDescription(monthlyPrice('$4.99'))
  await expect.element(premiumSheet().getByText(PREMIUM_RECORDINGS_BODY)).toBeVisible()
  await expect.element(premiumSheet().getByText(RENEWS_UNTIL_CANCELLED)).toBeVisible()
  await expect.element(premiumSheet().getByRole('button', { name: SUBSCRIBE })).toBeVisible()
  await expect.element(premiumSheet().getByRole('button', { name: SEE_PLAN })).toBeVisible()
})

it('trial account can subscribe', async () => {
  await openPaywall({ row: PAYWALL_TRIAL })

  await expect.element(annual()).toBeChecked()
  await expect.element(premiumSheet().getByRole('button', { name: SUBSCRIBE })).toBeVisible()
})

it('no store keeps See your plan and no choice', async () => {
  await openPaywall({ store: null })

  await expect.element(premiumSheet().getByRole('button', { name: SEE_PLAN })).toBeVisible()
  expect(premiumSheet().getByRole('radio').query()).toBeNull()
  expect(premiumSheet().getByRole('button', { name: SUBSCRIBE }).query()).toBeNull()
  expect(premiumSheet().getByText(SUBSCRIBE_OFFLINE).query()).toBeNull()
})

it('offers failing shows the offline line', async () => {
  await openPaywall({
    store: fakeStore({ offers: () => Promise.reject(new Error('unreachable')) }),
  })

  await expect.element(premiumSheet().getByText(SUBSCRIBE_OFFLINE)).toBeVisible()
  await expect.element(premiumSheet().getByRole('button', { name: SEE_PLAN })).toBeVisible()
  expect(premiumSheet().getByRole('radio').query()).toBeNull()
  expect(premiumSheet().getByRole('button', { name: SUBSCRIBE }).query()).toBeNull()
})

it('an offline browser shows the offline line', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const offers = vi.fn(fakeStore().offers)
  await openPaywall({ store: fakeStore({ offers }) })

  await expect.element(premiumSheet().getByText(SUBSCRIBE_OFFLINE)).toBeVisible()
  await expect.poll(() => offers.mock.calls.length).toBe(1)
  expect(premiumSheet().getByRole('radio').query()).toBeNull()
})

it('asks the store for offers once per opening', async () => {
  const offers = vi.fn(fakeStore().offers)
  await openPaywall({ store: fakeStore({ offers }) })
  await expect.element(annual()).toBeChecked()
  await premiumSheet().getByText(PERIOD_MONTHLY, { exact: true }).click()
  await expect.element(monthly()).toBeChecked()

  expect(offers).toHaveBeenCalledTimes(1)
})

it('subscribe waits for the sheet to close before purchasing', async () => {
  // What covers the page as the checkout opens: open dialogs, and anything hidden or inert.
  const coversAtPurchase: number[] = []
  const purchase = vi.fn(async () => {
    coversAtPurchase.push(
      document.querySelectorAll('[role="dialog"], body > [inert], body > [aria-hidden="true"]')
        .length,
    )
    return 'cancelled' as const
  })
  const { analytics } = await openPaywall({ store: fakeStore({ purchase }), from: 'upload' })
  await premiumSheet().getByText(PERIOD_MONTHLY, { exact: true }).click()
  await premiumSheet().getByRole('button', { name: SUBSCRIBE }).click()

  await expect.poll(() => purchase.mock.calls.length).toBe(1)
  expect(purchase).toHaveBeenCalledWith('monthly')
  expect(coversAtPurchase).toEqual([0])
  await expect.element(premiumSheet()).not.toBeInTheDocument()
  expect(purchaseSends(analytics)[0]).toEqual({
    name: 'purchase_started',
    props: { period: 'monthly', from: 'upload' },
  })
})

it('completed purchase refreshes, syncs, and shows the toast', async () => {
  const calls: string[] = []
  const engine = fakeEngine({
    refreshBilling: vi.fn(async () => void calls.push('refresh')),
    sync: vi.fn(async () => void calls.push('sync')),
  })
  const { analytics } = await openPaywall({ engine })
  await premiumSheet().getByRole('button', { name: SUBSCRIBE }).click()

  await expect.element(page.getByText(SUBSCRIBED)).toBeVisible()
  await expect.poll(() => calls).toEqual(['refresh', 'sync'])
  expect(purchaseSends(analytics)).toEqual([
    { name: 'purchase_started', props: { period: 'annual', from: 'record' } },
    { name: 'purchase_completed', props: { period: 'annual' } },
  ])
})

it('a failed refresh still syncs and shows the toast', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const sync = vi.fn(async () => {})
  const engine = fakeEngine({
    refreshBilling: () => Promise.reject(new Error('server down')),
    sync,
  })
  await openPaywall({ engine })
  await premiumSheet().getByRole('button', { name: SUBSCRIBE }).click()

  await expect.element(page.getByText(SUBSCRIBED)).toBeVisible()
  await expect.poll(() => sync.mock.calls.length).toBe(1)
  expect(page.getByText(SUBSCRIBE_FAILED).query()).toBeNull()
})

it('cancelled purchase shows nothing', async () => {
  const { analytics } = await openPaywall({
    store: fakeStore({ purchase: async () => 'cancelled' }),
  })
  await premiumSheet().getByRole('button', { name: SUBSCRIBE }).click()

  await expect
    .poll(() => purchaseSends(analytics))
    .toEqual([
      { name: 'purchase_started', props: { period: 'annual', from: 'record' } },
      { name: 'purchase_failed', props: { period: 'annual', reason: 'cancelled' } },
    ])
  expect(page.getByText(SUBSCRIBED).query()).toBeNull()
  expect(page.getByText(SUBSCRIBE_FAILED).query()).toBeNull()
})

it('failed purchase shows the failure toast', async () => {
  const { analytics } = await openPaywall({
    store: fakeStore({ purchase: () => Promise.reject(new Error('declined')) }),
  })
  await premiumSheet().getByRole('button', { name: SUBSCRIBE }).click()

  await expect.element(page.getByText(SUBSCRIBE_FAILED)).toBeVisible()
  expect(purchaseSends(analytics)).toEqual([
    { name: 'purchase_started', props: { period: 'annual', from: 'record' } },
    { name: 'purchase_failed', props: { period: 'annual', reason: 'error' } },
  ])
})

it('plan reason titles the sheet Crosstune Premium', async () => {
  const { analytics } = await openPaywall({ reason: 'plan', from: 'plan_group' })

  const dialog = page.getByRole('dialog', { name: PREMIUM_PLAN_TITLE })
  await expect.element(dialog).toHaveAccessibleDescription(PREMIUM_PLAN_BODY)
  await expect.element(dialog.getByRole('radio', { name: PERIOD_ANNUAL })).toBeChecked()
  expect(analytics.sends()).toEqual([
    { name: 'premium_sheet_shown', props: { reason: 'plan', from: 'plan_group' } },
  ])
})

it('a paid account sees the plan reason without a choice', async () => {
  const offers = vi.fn(fakeStore().offers)
  await openPaywall({
    row: { premium_source: 'stripe', premium_expires_at: null },
    store: fakeStore({ offers }),
    reason: 'plan',
    from: 'plan_group',
  })

  const dialog = page.getByRole('dialog', { name: PREMIUM_PLAN_TITLE })
  await expect.element(dialog.getByRole('button', { name: SEE_PLAN })).toBeVisible()
  // The sheet asks for offers as it opens, so by now a paid account would have asked.
  expect(offers).not.toHaveBeenCalled()
  expect(dialog.getByRole('radio').query()).toBeNull()
})

it('labels the period choice apart from the Plan group', async () => {
  await openPaywall()

  await expect
    .element(premiumSheet().getByRole('radiogroup', { name: BILLING_PERIOD }))
    .toBeVisible()
})

it('a store that sells nothing keeps See your plan with no offline line', async () => {
  let answered = false
  await openPaywall({
    store: fakeStore({
      offers: async () => {
        answered = true
        return []
      },
    }),
  })

  await expect.poll(() => answered).toBe(true)
  await expect.element(premiumSheet().getByRole('button', { name: SEE_PLAN })).toBeVisible()
  await expect.element(premiumSheet().getByText(SUBSCRIBE_OFFLINE)).not.toBeInTheDocument()
  expect(premiumSheet().getByRole('radio').query()).toBeNull()
  expect(premiumSheet().getByRole('button', { name: SUBSCRIBE }).query()).toBeNull()
})

it('reopening the sheet as it leaves drops the checkout Subscribe chose', async () => {
  const purchase = vi.fn(async () => 'cancelled' as const)
  const { launcher } = await openPaywall({ store: fakeStore({ purchase }) })
  await expect.element(annual()).toBeChecked()

  const subscribe = premiumSheet().getByRole('button', { name: SUBSCRIBE }).element()
  // Pressed and reopened in one task, so the sheet cannot finish leaving in between.
  ;(subscribe as HTMLElement).click()
  launcher().open('recordings', 'record')

  await expect.element(annual()).toBeVisible()
  await premiumSheet().getByText(PERIOD_MONTHLY, { exact: true }).click()
  await premiumSheet().getByRole('button', { name: SUBSCRIBE }).click()
  // Only the second choice reaches the store: the first was dropped when the sheet reopened.
  await expect.poll(() => purchase.mock.calls).toEqual([['monthly']])
})
