import Dexie from 'dexie'
import { useContext, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import { RECORD_LABEL } from '../../layout/tabs'
import { destination } from '../../layout/destinations'
import type { Store } from '../../billing/store'
import type * as StoreConfigModule from '../../billing/storeConfig'
import { StoreProvider } from '../../billing/StoreProvider'
import { useEntitlement, usePlan } from '../../billing/usePlan'
import { createTune } from '../../commands/tunes'
import { DbContext } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalEntitlement, LocalRecording } from '../../db/types'
import { openTestDb } from '../../test/db'
import { planSheet } from '../../test/planSheet'
import { fakeMediaForTest } from '../../test/fakeMedia'
import { fakeStore } from '../../test/fakeStore'
import { renderApp } from '../../test/renderApp'
import { dataProviders, fakeEngine } from '../../test/providers'
import { contrastRatio, glyphColor, paintedBackground } from '../../test/contrast'
import { renderWithProviders } from '../../test/render'
import { entitlementRow, recordingFile, recordingRow } from '../../test/rows'
import type { SyncEngine } from '../../sync/types'
import { Button } from '../../ui/Button'
import { CANCEL, CLOSE, OK } from '../../ui/confirmCopy'
import { FixedNow } from '../../ui/useNow'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import type { PremiumEntry, PremiumReason } from '../../usage/events'
import { recordingAnalytics } from '../../usage/testing'
import { addedDay } from '../../text/format'
import { NEW_RECORDING } from '../capture/recordCopy'
import { EXPORT_BLOCK_REASONS, TRY_AGAIN } from '../recordings/export/exportCopy'
import { DOWNLOAD } from '../recordings/recordingNames'
import { EXPORT_TITLE } from '../settings/export/exportCopy'
import { SEARCH_RECORDINGS, UPLOAD_AUDIO } from '../recordings/recordingsCopy'
import { RECORD as CARD_RECORD } from '../tune/tuneMediaCopy'
import { TUNE } from '../tune/tunePageCopy'
import { COMPARISON, type Cell } from './comparison'
import { CELL_EXCLUDED, CELL_INCLUDED } from './PlanComparison'
import {
  annualPrice,
  APP_STORE_SUBSCRIPTIONS_URL,
  BILLING_PERIOD,
  COMPARE_FREE,
  COMPARE_PREMIUM,
  ENDS,
  EXPORT_EVERYTHING,
  EXPORT_THIS_RECORDING,
  RECORDINGS_COST,
  SUBSCRIBE_OR_EXPORT,
  INCLUDED,
  LAPSED_PREMIUM_TITLE,
  MANAGE_APP_STORE,
  MANAGE_SUBSCRIPTION,
  monthlyPrice,
  ON_PREMIUM,
  PERIOD_ANNUAL,
  PERIOD_MONTHLY,
  PLAN_TRIAL,
  PREMIUM_PLAN_TITLE,
  PREMIUM_RECORDINGS_TITLE,
  PREMIUM_SCANS_BODY,
  PREMIUM_SCANS_TITLE,
  PRIVACY_POLICY,
  PRIVACY_URL,
  type PremiumSubject,
  RENEWS,
  renewalTerms,
  RENEWS_UNTIL_CANCELLED,
  save,
  SEE_PLAN,
  SUBSCRIBE,
  SUBSCRIBE_FAILED_MESSAGE,
  SUBSCRIBE_FAILED_TITLE,
  SUBSCRIBE_OFFLINE,
  SUBSCRIBE_UNAVAILABLE_MESSAGE,
  SUBSCRIBE_UNAVAILABLE_TITLE,
  SUBSCRIBED,
  TERMS_OF_USE,
  TERMS_URL,
  THANKS,
  TRIAL_KEEPS,
  TRIAL_STORAGE,
  trialDaysLeft,
  trialEnds,
  trialLeft,
} from './planCopy'
import { INCLUDED_FEATURES } from './included'
import {
  PremiumSheetProvider,
  usePremiumSheet,
  type PremiumSheetLauncher,
} from './PremiumSheetProvider'

vi.mock('@clerk/react', () => import('../../fixture/clerkStub'))

const config = vi.hoisted(() => ({ portalUrl: '' }))

vi.mock('../../billing/storeConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof StoreConfigModule>()
  return { storeConfig: () => ({ ...actual.storeConfig(), portalUrl: config.portalUrl }) }
})

const WIDE = { width: 1280, height: 800 }
const DAY = 86_400_000
const FREE: Partial<LocalEntitlement> = {}

const recordSheet = () => page.getByRole('dialog', { name: NEW_RECORDING })
const headline = (name: string) => planSheet().getByRole('heading', { level: 2, name, exact: true })

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

it('answers Record on a free plan with the Plan sheet, not the recorder', async () => {
  fakeMediaForTest()
  const { analytics } = await mount(openTestDb(), '/catalog', FREE)
  await page.getByRole('button', { name: RECORD_LABEL }).click()

  await expect.element(headline(PREMIUM_RECORDINGS_TITLE)).toBeVisible()
  await expect.element(planSheet().getByText(RECORDINGS_COST)).toBeVisible()
  await expect.element(recordSheet()).not.toBeInTheDocument()
  expect(planSheet().getByRole('button', { name: SEE_PLAN }).query()).toBeNull()
  await expect
    .poll(() => analytics.sends())
    .toEqual([
      {
        name: 'premium_sheet_shown',
        props: { reason: 'recordings', from: 'record', presentation: 'sheet' },
      },
    ])
})

it("answers Record on a tune's start card with the Plan sheet on a free plan", async () => {
  fakeMediaForTest()
  const db = openTestDb()
  const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
  const { analytics } = await mount(db, `/catalog/${tuneId}`, FREE)
  await page
    .getByRole('main', { name: TUNE })
    .getByRole('button', { name: CARD_RECORD, exact: true })
    .click()

  await expect.element(headline(PREMIUM_RECORDINGS_TITLE)).toBeVisible()
  await expect.element(recordSheet()).not.toBeInTheDocument()
  await expect
    .poll(() => shown(analytics))
    .toEqual([
      {
        name: 'premium_sheet_shown',
        props: { reason: 'recordings', from: 'record', presentation: 'sheet' },
      },
    ])
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

it('answers a dropped audio file on a free plan with the Plan sheet, adding nothing', async () => {
  const db = openTestDb()
  const { analytics } = await mount(db, destination('recordings').root, FREE)
  await expect.element(page.getByRole('searchbox', { name: SEARCH_RECORDINGS })).toBeVisible()
  drop([new File(['abc'], 'jam.m4a', { type: 'audio/mp4' })])

  await expect.element(planSheet()).toBeVisible()
  await expect
    .poll(() => shown(analytics))
    .toEqual([
      {
        name: 'premium_sheet_shown',
        props: { reason: 'recordings', from: 'upload', presentation: 'sheet' },
      },
    ])
  expect(await db.recordings.count()).toBe(0)
  expect(analytics.sends().filter((send) => send.name === 'audio_imported')).toEqual([])
})

it('answers Upload on a free plan with the Plan sheet', async () => {
  const { analytics } = await mount(openTestDb(), destination('recordings').root, FREE)
  await page.getByRole('button', { name: UPLOAD_AUDIO }).click()

  await expect.element(planSheet()).toBeVisible()
  await expect
    .poll(() => shown(analytics))
    .toEqual([
      {
        name: 'premium_sheet_shown',
        props: { reason: 'recordings', from: 'upload', presentation: 'sheet' },
      },
    ])
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
  await expect.element(planSheet()).not.toBeInTheDocument()
})

function ScansOpener() {
  const premium = usePremiumSheet()
  return <Button label="Open scans" onPress={() => premium.open('scans', 'scan')} />
}

it('opens the scans sheet already describing why scans are held', async () => {
  const db = openTestDb()
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
      <PremiumSheetProvider>
        <ScansOpener />
      </PremiumSheetProvider>
    </Data>,
  )
  await page.getByRole('button', { name: 'Open scans' }).click()

  await expect.element(planSheet()).toHaveAccessibleDescription(PREMIUM_SCANS_BODY)
  await expect.element(headline(PREMIUM_SCANS_TITLE)).toBeVisible()
  expect(descriptions).not.toContain(null)
  expect(analytics.sends()).toEqual([
    {
      name: 'premium_sheet_shown',
      props: { reason: 'scans', from: 'scan', presentation: 'sheet' },
    },
  ])
})

const NOW = Date.parse('2026-10-10T12:00:00.000Z')
const PAYWALL_TRIAL: Partial<LocalEntitlement> = {
  premium_source: 'trial',
  premium_expires_at: new Date(NOW + 10 * DAY).toISOString(),
  trial_starts_at: new Date(NOW - 4 * DAY).toISOString(),
  trial_ends_at: new Date(NOW + 10 * DAY).toISOString(),
}

function Opener({
  reason,
  from,
  subject,
}: {
  reason: PremiumReason
  from: PremiumEntry
  subject?: PremiumSubject
}) {
  const premium = usePremiumSheet()
  return <Button label="Open Premium" onPress={() => premium.open(reason, from, subject)} />
}

/** Hands out the sheet's launcher, so a test can open the sheet at a moment no tap could. */
function HoldLauncher({ onLauncher }: { onLauncher: (launcher: PremiumSheetLauncher) => void }) {
  const launcher = usePremiumSheet()
  useEffect(() => onLauncher(launcher), [launcher, onLauncher])
  return null
}

/** Mounts the Plan sheet over a seeded plan and store, and opens it once the plan is judged. */
async function openPaywall({
  row = FREE,
  store = fakeStore(),
  engine = fakeEngine(),
  reason = 'recordings',
  from = 'record',
  subject,
  seed,
  plan = row.premium_source ? 'premium' : 'free',
  density = 'pointer',
  scheme = 'light',
  wrap = (children) => children,
}: {
  row?: Partial<LocalEntitlement>
  store?: Store | null
  engine?: SyncEngine
  reason?: PremiumReason
  from?: PremiumEntry
  subject?: PremiumSubject
  /** Writes rows before the sheet mounts. */
  seed?: (db: CrosstuneDb) => Promise<void>
  /** The plan the row reads as, which a lapsed row's source does not say. */
  plan?: 'premium' | 'free'
  density?: 'pointer' | 'touch'
  scheme?: 'light' | 'dark'
  /** Wraps the sheet's provider, inside the store. */
  wrap?: (children: ReactNode) => ReactNode
} = {}) {
  const db = openTestDb()
  await db.entitlements.put(entitlementRow(row))
  await seed?.(db)
  const analytics = recordingAnalytics()
  const Data = dataProviders({ db, analytics, engine })
  const holder: { launcher?: PremiumSheetLauncher } = {}
  renderWithProviders(
    <Data>
      <FixedNow value={NOW}>
        <StoreProvider store={store}>
          {wrap(
            <PremiumSheetProvider>
              <Opener reason={reason} from={from} subject={subject} />
              <HoldLauncher
                onLauncher={(launcher) => {
                  holder.launcher = launcher
                }}
              />
              <PlanProbe />
            </PremiumSheetProvider>,
          )}
        </StoreProvider>
      </FixedNow>
    </Data>,
    { density, scheme },
  )
  await expect.element(page.getByTestId('plan')).toHaveTextContent(plan)
  await page.getByRole('button', { name: 'Open Premium' }).click()
  return { db, analytics, launcher: () => holder.launcher! }
}

const LAPSED_PAID: Partial<LocalEntitlement> = {
  premium_source: 'stripe',
  premium_expires_at: new Date(NOW - DAY).toISOString(),
}
const SUBJECT: PremiumSubject = { recordingId: 'r1' }

/** Seeds `count` recordings, r1 onward, each on the server only. */
const recordings = (count: number) => async (db: CrosstuneDb) => {
  await db.recordings.bulkPut(
    Array.from({ length: count }, (_, i) => recordingRow(`r${i + 1}`, { position: i })),
  )
}

const lapsed = (options: Parameters<typeof openPaywall>[0] = {}) =>
  openPaywall({ row: LAPSED_PAID, plan: 'free', ...options })

/** An engine whose file fetches never answer, and a check that only the subject was fetched. */
function heldFetch() {
  const fetchFile = vi.fn(
    (_kind: string, _id: string, signal?: AbortSignal) =>
      new Promise<Blob>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason))
      }),
  )
  return {
    engine: fakeEngine({ fetchFile }),
    exportedSubject: () =>
      expect
        .poll(() => fetchFile.mock.calls.map(([kind, id]) => [kind, id]))
        .toEqual([['recording', SUBJECT.recordingId]]),
  }
}

it('leads with the lapse and asks to subscribe or export', async () => {
  await lapsed({ seed: recordings(12) })

  await expect.element(headline(LAPSED_PREMIUM_TITLE)).toBeVisible()
  await expect.element(planSheet().getByText(SUBSCRIBE_OR_EXPORT, { exact: false })).toBeVisible()
  await expect.element(planSheet().getByRole('button', { name: EXPORT_EVERYTHING })).toBeVisible()
})

it.each([
  { opened: 'anywhere', subject: undefined, action: EXPORT_EVERYTHING },
  { opened: 'one recording', subject: SUBJECT, action: EXPORT_THIS_RECORDING },
])(
  'offers an export to a free account that never had Premium, opened from $opened',
  async ({ subject, action }) => {
    await openPaywall({ seed: recordings(3), subject })

    await expect.element(headline(PREMIUM_RECORDINGS_TITLE)).toBeVisible()
    await expect.element(planSheet().getByRole('button', { name: action })).toBeVisible()
  },
)

it('exports the recording it opened from', async () => {
  const { engine, exportedSubject } = heldFetch()
  await lapsed({ seed: recordings(2), subject: SUBJECT, engine })
  await planSheet().getByRole('button', { name: EXPORT_THIS_RECORDING }).click()

  await expect.element(planSheet()).not.toBeInTheDocument()
  await expect.element(page.getByRole('dialog', { name: DOWNLOAD })).toBeVisible()
  await exportedSubject()
})

it.each([
  {
    action: EXPORT_EVERYTHING,
    subject: undefined,
    sheet: EXPORT_TITLE,
    says: null,
  },
  {
    action: EXPORT_THIS_RECORDING,
    subject: SUBJECT,
    sheet: DOWNLOAD,
    says: EXPORT_BLOCK_REASONS.not_ready,
  },
])(
  '$action opens its export once the Plan sheet leaves',
  async ({ action, subject, sheet, says }) => {
    await lapsed({
      seed: async (db) => {
        await recordings(2)(db)
        await db.recordings.update(SUBJECT.recordingId, { state: 'pending_upload' })
      },
      subject,
    })
    await planSheet().getByRole('button', { name: action }).click()

    await expect.element(planSheet()).not.toBeInTheDocument()
    const opened = page.getByRole('dialog', { name: sheet })
    await expect.element(opened).toBeVisible()
    if (says) await expect.element(opened.getByText(says)).toBeVisible()
  },
)

it('shows a failed download of a recording held here in the download sheet', async () => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
    throw new Error('blocked')
  })
  await lapsed({
    seed: async (db) => {
      await recordings(2)(db)
      await db.recording_files.put(
        recordingFile(SUBJECT.recordingId, { blob: new Blob(['audio'], { type: 'audio/mp4' }) }),
      )
    },
    subject: SUBJECT,
  })
  await planSheet().getByRole('button', { name: EXPORT_THIS_RECORDING }).click()

  await expect.element(planSheet()).not.toBeInTheDocument()
  const download = page.getByRole('dialog', { name: DOWNLOAD })
  await expect.element(download.getByRole('button', { name: TRY_AGAIN })).toBeVisible()
})

it('downloads a recording held here with no download sheet', async () => {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL')
  await lapsed({
    seed: async (db) => {
      await recordings(2)(db)
      await db.recording_files.put(
        recordingFile(SUBJECT.recordingId, { blob: new Blob(['audio'], { type: 'audio/mp4' }) }),
      )
    },
    subject: SUBJECT,
  })
  await planSheet().getByRole('button', { name: EXPORT_THIS_RECORDING }).click()

  await expect.poll(() => createObjectURL.mock.calls.length).toBeGreaterThan(0)
  await expect.element(page.getByRole('dialog', { name: DOWNLOAD })).not.toBeInTheDocument()
})

it.each([
  { read: 'reads', settle: (count: ReturnType<typeof held<number>>) => count.resolve(12) },
  {
    read: 'fails',
    settle: (count: ReturnType<typeof held<number>>) => count.reject(new Error('read failed')),
  },
])('holds the sheet until the recording count $read, then opens it', async ({ read, settle }) => {
  const count = held<number>()
  await lapsed({
    seed: async (db) => {
      // The count runs inside a transaction, which commits while it awaits a promise that is not
      // an IndexedDB request. Dexie.waitFor keeps the transaction open for the held promise.
      vi.spyOn(db.recordings, 'count').mockImplementation(
        () => Dexie.waitFor(count.promise) as ReturnType<typeof db.recordings.count>,
      )
    },
  })
  await expect.element(planSheet()).not.toBeInTheDocument()

  settle(count)
  await expect.element(headline(LAPSED_PREMIUM_TITLE)).toBeVisible()
  if (read === 'reads') {
    await expect.element(planSheet().getByRole('button', { name: EXPORT_EVERYTHING })).toBeVisible()
  } else {
    expect(planSheet().getByRole('button', { name: EXPORT_EVERYTHING }).query()).toBeNull()
  }
})

it('keeps the sheet open when Export this recording is pressed before the recording reads', async () => {
  const { engine, exportedSubject } = heldFetch()
  const row = held<LocalRecording | undefined>()
  let read: ReturnType<typeof vi.spyOn> | undefined
  await lapsed({
    seed: async (db) => {
      await recordings(2)(db)
      read = vi
        .spyOn(db.recordings, 'get')
        .mockReturnValue(row.promise as unknown as ReturnType<typeof db.recordings.get>)
    },
    subject: SUBJECT,
    engine,
  })
  await planSheet().getByRole('button', { name: EXPORT_THIS_RECORDING }).click()

  row.resolve(recordingRow(SUBJECT.recordingId))
  await expect.poll(() => read?.mock.settledResults.length ?? 0).toBeGreaterThan(0)
  await expect.element(planSheet()).toBeVisible()
  await planSheet().getByRole('button', { name: EXPORT_THIS_RECORDING }).click()
  await expect.element(page.getByRole('dialog', { name: DOWNLOAD })).toBeVisible()
  await exportedSubject()
})

it('offers everything when the subject is gone', async () => {
  const { db } = await lapsed({ seed: recordings(2), subject: SUBJECT })
  await expect
    .element(planSheet().getByRole('button', { name: EXPORT_THIS_RECORDING }))
    .toBeVisible()

  await db.recordings.update(SUBJECT.recordingId, { deleted_at: new Date(NOW).toISOString() })
  await expect.element(planSheet().getByRole('button', { name: EXPORT_EVERYTHING })).toBeVisible()
  expect(planSheet().getByRole('button', { name: EXPORT_THIS_RECORDING }).query()).toBeNull()
})

const purchaseSends = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.sends().filter((send) => send.name.startsWith('purchase_'))

const annual = () => planSheet().getByRole('radio', { name: PERIOD_ANNUAL, exact: true })
const monthly = () => planSheet().getByRole('radio', { name: PERIOD_MONTHLY, exact: true })

const cellText = (cell: Cell) =>
  cell.kind === 'included' ? CELL_INCLUDED : cell.kind === 'excluded' ? CELL_EXCLUDED : cell.text

/** Each body row of the comparison as its feature, Free cell, and Premium cell. */
function comparisonRows(): (string | null)[][] {
  const table = planSheet().getByRole('table').element()
  return [...table.querySelectorAll('tbody tr')].map((row) =>
    [...row.children].map((cell) => cell.textContent),
  )
}

it('a free account compares Free and Premium and subscribes annually by default', async () => {
  await openPaywall()

  await expect.element(planSheet().getByRole('table')).toBeVisible()
  await expect
    .element(planSheet().getByRole('columnheader', { name: COMPARE_FREE, exact: true }))
    .toBeVisible()
  await expect
    .element(planSheet().getByRole('columnheader', { name: COMPARE_PREMIUM, exact: true }))
    .toBeVisible()
  expect(comparisonRows()).toEqual(
    COMPARISON.map((feature) => [feature.title, cellText(feature.free), cellText(feature.premium)]),
  )
  await expect.element(annual()).toBeChecked()
  await expect.element(annual()).toHaveAccessibleDescription(`${annualPrice('$49.99')} ${save(17)}`)
  await expect.element(monthly()).not.toBeChecked()
  await expect.element(monthly()).toHaveAccessibleDescription(monthlyPrice('$4.99'))
  await expect.element(planSheet().getByText(renewalTerms('$49.99', 'annual', true))).toBeVisible()
  await expect
    .element(planSheet().getByRole('link', { name: TERMS_OF_USE }))
    .toHaveAttribute('href', TERMS_URL)
  await expect
    .element(planSheet().getByRole('link', { name: PRIVACY_POLICY }))
    .toHaveAttribute('href', PRIVACY_URL)
  await expect.element(planSheet().getByRole('button', { name: SUBSCRIBE })).toBeVisible()
  expect(planSheet().getByText(PLAN_TRIAL, { exact: true }).query()).toBeNull()
})

it('a trial account sees its trial card with 100 MB', async () => {
  await openPaywall({ row: PAYWALL_TRIAL })

  const ends = new Date(NOW + 10 * DAY)
  await expect.element(planSheet().getByText(PLAN_TRIAL, { exact: true })).toBeVisible()
  await expect
    .element(planSheet().getByText(trialDaysLeft(ends, new Date(NOW)), { exact: true }))
    .toBeVisible()
  await expect.element(planSheet().getByText(trialEnds(ends), { exact: true })).toBeVisible()
  await expect.element(planSheet().getByText(TRIAL_STORAGE)).toBeVisible()
  await expect.element(planSheet().getByText(TRIAL_KEEPS)).toBeVisible()
  // Four of the trial's fourteen days have passed.
  await expect
    .element(planSheet().getByRole('progressbar', { name: PLAN_TRIAL }))
    .toHaveAttribute('aria-valuenow', '29')
  await expect
    .element(planSheet().getByRole('progressbar', { name: PLAN_TRIAL }))
    .toHaveAttribute('aria-valuetext', trialLeft(ends, new Date(NOW)))
  await expect.element(annual()).toBeChecked()
  await expect.element(planSheet().getByRole('button', { name: SUBSCRIBE })).toBeVisible()
})

it('subscribes to the one period the store sells', async () => {
  const purchase = vi.fn(async () => 'cancelled' as const)
  await openPaywall({
    store: fakeStore({
      offers: async () => [{ period: 'monthly', price: '$4.99', amountMicros: 4_990_000 }],
      purchase,
    }),
  })
  await expect.element(monthly()).toBeChecked()
  await planSheet().getByRole('button', { name: SUBSCRIBE }).click()

  await expect.poll(() => purchase.mock.calls).toEqual([['monthly']])
})

it('offers failing while online show the unavailable alert over the sheet and no tiles', async () => {
  await openPaywall({
    store: fakeStore({ offers: () => Promise.reject(new Error('unreachable')) }),
  })

  const alert = storeAlert(SUBSCRIBE_UNAVAILABLE_TITLE)
  await expect.element(alert).toBeVisible()
  await expect.element(alert.getByText(SUBSCRIBE_UNAVAILABLE_MESSAGE)).toBeVisible()
  expect(planSheet().getByText(SUBSCRIBE_OFFLINE).query()).toBeNull()
  await alert.getByRole('button', { name: OK }).click()

  await expect.element(alert).not.toBeInTheDocument()
  await expect.element(planSheet().getByRole('table')).toBeVisible()
  expect(planSheet().getByRole('radio').query()).toBeNull()
  expect(planSheet().getByRole('button', { name: SUBSCRIBE }).query()).toBeNull()
})

it('asks the store again on reconnecting after it failed offline', async () => {
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  let reachable = false
  const offers = vi.fn(() =>
    reachable ? fakeStore().offers() : Promise.reject(new Error('unreachable')),
  )
  await openPaywall({ store: fakeStore({ offers }) })
  await expect.element(planSheet().getByText(SUBSCRIBE_OFFLINE)).toBeVisible()
  await expect.poll(() => offers.mock.calls.length).toBe(1)

  reachable = true
  onLine.mockReturnValue(true)
  window.dispatchEvent(new Event('online'))

  await expect.element(annual()).toBeChecked()
  expect(storeAlert(SUBSCRIBE_UNAVAILABLE_TITLE).query()).toBeNull()
  await expect.poll(() => offers.mock.calls.length).toBe(2)
})

it('asks the store for offers once per opening', async () => {
  const offers = vi.fn(fakeStore().offers)
  await openPaywall({ store: fakeStore({ offers }) })
  await expect.element(annual()).toBeChecked()
  await planSheet().getByText(PERIOD_MONTHLY, { exact: true }).click()
  await expect.element(monthly()).toBeChecked()
  await expect.element(planSheet().getByText(renewalTerms('$4.99', 'monthly', true))).toBeVisible()
  expect(
    planSheet()
      .getByText(renewalTerms('$49.99', 'annual', true))
      .query(),
  ).toBeNull()
  await expect.element(planSheet().getByRole('link', { name: TERMS_OF_USE })).toBeVisible()
  await expect.element(planSheet().getByRole('link', { name: PRIVACY_POLICY })).toBeVisible()

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
  await planSheet().getByText(PERIOD_MONTHLY, { exact: true }).click()
  await planSheet().getByRole('button', { name: SUBSCRIBE }).click()

  await expect.poll(() => purchase.mock.calls.length).toBe(1)
  expect(purchase).toHaveBeenCalledWith('monthly')
  expect(coversAtPurchase).toEqual([0])
  await expect.element(planSheet()).not.toBeInTheDocument()
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
  await planSheet().getByRole('button', { name: SUBSCRIBE }).click()

  await expect.element(page.getByText(SUBSCRIBED)).toBeVisible()
  await expect.poll(() => calls).toEqual(['refresh', 'sync'])
  expect(purchaseSends(analytics)).toEqual([
    { name: 'purchase_started', props: { period: 'annual', from: 'record' } },
    { name: 'purchase_completed', props: { period: 'annual' } },
  ])
})

it('a completed purchase keeps the settled line until the plan turns Premium', async () => {
  const { db, launcher } = await openPaywall()
  await planSheet().getByRole('button', { name: SUBSCRIBE }).click()
  await expect.element(page.getByText(SUBSCRIBED)).toBeVisible()
  await expect.element(planSheet()).not.toBeInTheDocument()

  // Records whether the reopened sheet ever offers a period, which would sell to a buyer.
  let offered = false
  const observer = new MutationObserver(() => {
    if (document.querySelector('[role="dialog"] [role="radio"]')) offered = true
  })
  observer.observe(document.body, { subtree: true, childList: true })
  onTestFinished(() => observer.disconnect())
  launcher().open('plan', 'plan_group')

  await expect.element(planSheet().getByText(SUBSCRIBED, { exact: true })).toBeVisible()
  expect(planSheet().getByRole('button', { name: SUBSCRIBE }).query()).toBeNull()

  await db.entitlements.put(entitlementRow({ premium_source: 'stripe', premium_expires_at: null }))
  await expect.element(headline(ON_PREMIUM)).toBeVisible()
  await expect.element(planSheet().getByText(SUBSCRIBED, { exact: true })).not.toBeInTheDocument()
  expect(offered).toBe(false)
})

it('a failed refresh still syncs and shows the toast', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const sync = vi.fn(async () => {})
  const engine = fakeEngine({
    refreshBilling: () => Promise.reject(new Error('server down')),
    sync,
  })
  await openPaywall({ engine })
  await planSheet().getByRole('button', { name: SUBSCRIBE }).click()

  await expect.element(page.getByText(SUBSCRIBED)).toBeVisible()
  await expect.poll(() => sync.mock.calls.length).toBe(1)
  expect(storeAlert(SUBSCRIBE_FAILED_TITLE).query()).toBeNull()
})

it('cancelled purchase shows nothing', async () => {
  const { analytics } = await openPaywall({
    store: fakeStore({ purchase: async () => 'cancelled' }),
  })
  await planSheet().getByRole('button', { name: SUBSCRIBE }).click()

  await expect
    .poll(() => purchaseSends(analytics))
    .toEqual([
      { name: 'purchase_started', props: { period: 'annual', from: 'record' } },
      { name: 'purchase_failed', props: { period: 'annual', reason: 'cancelled' } },
    ])
  expect(page.getByText(SUBSCRIBED).query()).toBeNull()
  expect(storeAlert(SUBSCRIBE_FAILED_TITLE).query()).toBeNull()
})

it('failed purchase shows the failure alert', async () => {
  const { analytics } = await openPaywall({
    store: fakeStore({ purchase: () => Promise.reject(new Error('declined')) }),
  })
  await planSheet().getByRole('button', { name: SUBSCRIBE }).click()

  const alert = storeAlert(SUBSCRIBE_FAILED_TITLE)
  await expect.element(alert).toBeVisible()
  await expect.element(alert.getByText(SUBSCRIBE_FAILED_MESSAGE)).toBeVisible()
  expect(purchaseSends(analytics)).toEqual([
    { name: 'purchase_started', props: { period: 'annual', from: 'record' } },
    { name: 'purchase_failed', props: { period: 'annual', reason: 'error' } },
  ])
})

it('labels the period choice', async () => {
  await openPaywall()

  await expect.element(planSheet().getByRole('radiogroup', { name: BILLING_PERIOD })).toBeVisible()
})

it('a store that sells nothing shows no choice and no offline line, and keeps the header close', async () => {
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
  await expect.element(planSheet().getByRole('table')).toBeVisible()
  await expect.element(planSheet().getByText(SUBSCRIBE_OFFLINE)).not.toBeInTheDocument()
  await expect.element(planSheet().getByRole('button', { name: SUBSCRIBE })).not.toBeInTheDocument()
  expect(planSheet().getByRole('radio').query()).toBeNull()
  expect(planSheet().getByText(RENEWS_UNTIL_CANCELLED, { exact: false }).query()).toBeNull()
  expect(planSheet().getByRole('button', { name: CANCEL }).query()).toBeNull()
  expect(closeControl()).toBe('header')
})

it('reopening the sheet as it leaves drops the checkout Subscribe chose', async () => {
  const purchase = vi.fn(async () => 'cancelled' as const)
  const { launcher } = await openPaywall({ store: fakeStore({ purchase }) })
  await expect.element(annual()).toBeChecked()

  const subscribe = planSheet().getByRole('button', { name: SUBSCRIBE }).element()
  // Pressed and reopened in one task, so the sheet cannot finish leaving in between.
  ;(subscribe as HTMLElement).click()
  launcher().open('recordings', 'record')

  await expect.element(annual()).toBeVisible()
  await planSheet().getByText(PERIOD_MONTHLY, { exact: true }).click()
  await planSheet().getByRole('button', { name: SUBSCRIBE }).click()
  // Only the second choice reaches the store: the first was dropped when the sheet reopened.
  await expect.poll(() => purchase.mock.calls).toEqual([['monthly']])
})

it('fits a narrow phone, wrapping the terms rather than scrolling sideways', async () => {
  await page.viewport(320, 640)
  onTestFinished(() => page.viewport(390, 844))
  await openPaywall({ density: 'touch' })

  const terms = planSheet().getByRole('link', { name: PRIVACY_POLICY })
  await expect.element(terms).toBeVisible()
  const sheet = planSheet().element()
  // A control's touch tap area reaches past its box by design and holds no content.
  const tapArea = (element: Element) =>
    parseFloat(getComputedStyle(element, '::after').width) > element.clientWidth
  const overflowing = [sheet, ...sheet.querySelectorAll('*')].filter(
    (element) =>
      element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 1 && !tapArea(element),
  )
  expect(overflowing).toEqual([])
  expect(terms.element().getBoundingClientRect().right).toBeLessThanOrEqual(320)
})

/** A promise the test settles by hand. */
function held<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

it('a reopen before the refresh lands already shows the settled line', async () => {
  const refresh = held()
  const engine = fakeEngine({ refreshBilling: () => refresh.promise })
  const { analytics } = await openPaywall({ engine })
  await planSheet().getByRole('button', { name: SUBSCRIBE }).click()
  await expect
    .poll(() => purchaseSends(analytics).map((send) => send.name))
    .toEqual(['purchase_started', 'purchase_completed'])
  await expect.element(planSheet()).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Open Premium' }).click()

  await expect.element(planSheet().getByText(SUBSCRIBED, { exact: true })).toBeVisible()
  expect(planSheet().getByRole('button', { name: SUBSCRIBE }).query()).toBeNull()
  expect(planSheet().getByRole('radio').query()).toBeNull()

  refresh.resolve()
  await expect.element(page.getByRole('status').getByText(SUBSCRIBED)).toBeVisible()
})

/** The way out of the sheet: the header's Close alone, or a Cancel or Close among its actions. */
function closeControl(): 'header' | 'actions' | 'none' {
  const dialog = planSheet().query()
  const buttons = [...(dialog?.querySelectorAll('button') ?? [])].filter((element) =>
    [CANCEL, CLOSE].includes(element.getAttribute('aria-label') ?? element.textContent ?? ''),
  )
  if (buttons.length === 0) return 'none'
  return buttons.length === 1 && buttons[0]!.closest('header') ? 'header' : 'actions'
}

/** Every place the way out has been while the sheet showed, from now until the test ends. */
function watchCloseControl(): () => ReadonlySet<string> {
  const places = new Set<string>([closeControl()])
  const observer = new MutationObserver(() => {
    if (planSheet().query()) places.add(closeControl())
  })
  observer.observe(document.body, { subtree: true, childList: true, attributes: true })
  onTestFinished(() => observer.disconnect())
  return () => places
}

it('holds the header close and an off Subscribe while asking, then fills in the choice', async () => {
  const answer = held<Awaited<ReturnType<Store['offers']>>>()
  await openPaywall({ store: fakeStore({ offers: () => answer.promise }) })

  const subscribe = planSheet().getByRole('button', { name: SUBSCRIBE })
  await expect.element(subscribe).toBeDisabled()
  const places = watchCloseControl()
  expect(planSheet().getByRole('button', { name: CANCEL }).query()).toBeNull()
  expect(planSheet().getByRole('radio').query()).toBeNull()

  answer.resolve(await fakeStore().offers())
  await expect.element(annual()).toBeChecked()
  await expect.element(subscribe).toBeEnabled()
  expect([...places()]).toEqual(['header'])
})

it('keeps the header close in place when asking fails, under the unavailable alert', async () => {
  const answer = held<Awaited<ReturnType<Store['offers']>>>()
  await openPaywall({ store: fakeStore({ offers: () => answer.promise }) })
  await expect.element(planSheet().getByRole('button', { name: SUBSCRIBE })).toBeDisabled()
  const places = watchCloseControl()

  answer.reject(new Error('unreachable'))
  await expect.element(storeAlert(SUBSCRIBE_UNAVAILABLE_TITLE)).toBeVisible()
  expect(planSheet().getByRole('button', { name: SUBSCRIBE }).query()).toBeNull()
  expect(planSheet().getByRole('button', { name: CANCEL }).query()).toBeNull()
  expect([...places()]).toEqual(['header'])
})

/** The alert a store failure raises, named by its title. */
function storeAlert(title: string) {
  return page.getByRole('alertdialog', { name: title })
}

/** Waits for the sheet to finish moving in, so the boxes inside it read where they rest. */
async function settled(sheet: Element): Promise<void> {
  await expect
    .poll(() => sheet.getBoundingClientRect().width)
    .toBeCloseTo((sheet as HTMLElement).offsetWidth, 0)
}

/** The nearest ancestor that scrolls vertically. */
function scroller(element: Element): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).overflowY === 'auto') return node
  }
  return null
}

it.each(['pointer', 'touch'] as const)(
  'ends the scrolling page with Subscribe and the terms on %s, pinning nothing',
  async (density) => {
    await openPaywall({ density })
    const subscribe = planSheet().getByRole('button', { name: SUBSCRIBE })
    await expect.element(subscribe).toBeEnabled()
    await settled(planSheet().element())

    const button = subscribe.element()
    const terms = planSheet().getByRole('link', { name: TERMS_OF_USE }).element()
    const table = planSheet().getByRole('table').element()
    const scrolling = scroller(table)
    expect(scrolling).not.toBeNull()
    expect(scroller(button)).toBe(scrolling)
    expect(scroller(terms)).toBe(scrolling)
    expect(planSheet().element().querySelector('footer')).toBeNull()
    expect(button.getBoundingClientRect().top).toBeGreaterThan(table.getBoundingClientRect().bottom)
  },
)

/** Swaps the account's database under the sheet's provider, as a session switch does. */
function SwitchAccount({ next, children }: { next: CrosstuneDb; children: ReactNode }) {
  const first = useContext(DbContext)
  const [switched, setSwitched] = useState(false)
  // One element type throughout, so the switch keeps the provider mounted.
  return (
    <DbContext value={switched ? next : first}>
      <Button label="Switch account" onPress={() => setSwitched(true)} />
      {children}
    </DbContext>
  )
}

it('never carries a settled purchase to another account', async () => {
  const other = openTestDb()
  await other.entitlements.put(entitlementRow(FREE))
  await openPaywall({ wrap: (children) => <SwitchAccount next={other}>{children}</SwitchAccount> })
  await planSheet().getByRole('button', { name: SUBSCRIBE }).click()
  await expect.element(page.getByText(SUBSCRIBED)).toBeVisible()
  await page.getByRole('button', { name: 'Open Premium' }).click()
  await expect.element(planSheet().getByText(SUBSCRIBED, { exact: true })).toBeVisible()
  await planSheet().getByRole('button', { name: CLOSE }).click()
  await expect.element(planSheet()).not.toBeInTheDocument()

  await page.getByRole('button', { name: 'Switch account' }).click()
  await page.getByRole('button', { name: 'Open Premium' }).click()

  await expect.element(annual()).toBeChecked()
  expect(planSheet().getByText(SUBSCRIBED, { exact: true }).query()).toBeNull()
})

it('a purchase that lands after an account switch never settles the new account', async () => {
  const other = openTestDb()
  await other.entitlements.put(entitlementRow(FREE))
  const checkout = held<'completed'>()
  const { analytics } = await openPaywall({
    store: fakeStore({ purchase: () => checkout.promise }),
    wrap: (children) => <SwitchAccount next={other}>{children}</SwitchAccount>,
  })
  await planSheet().getByRole('button', { name: SUBSCRIBE }).click()
  await expect
    .poll(() => purchaseSends(analytics).map((send) => send.name))
    .toEqual(['purchase_started'])
  await expect.element(planSheet()).not.toBeInTheDocument()

  await page.getByRole('button', { name: 'Switch account' }).click()
  checkout.resolve('completed')
  await expect
    .poll(() => purchaseSends(analytics).map((send) => send.name))
    .toEqual(['purchase_started', 'purchase_completed'])
  await page.getByRole('button', { name: 'Open Premium' }).click()

  await expect.element(annual()).toBeChecked()
  expect(planSheet().getByText(SUBSCRIBED, { exact: true }).query()).toBeNull()
})

it.each(['light', 'dark'] as const)(
  "draws the Free column's checks and dashes at 3:1 or more in %s",
  async (scheme) => {
    await openPaywall({ scheme })
    await expect.element(planSheet().getByRole('table')).toBeVisible()

    // The Premium column sits on a translucent color-mix tint the helper cannot measure.
    const table = planSheet().getByRole('table').element()
    const marks = [...table.querySelectorAll('tbody td:nth-of-type(1) svg')]
    expect(marks).toHaveLength(COMPARISON.filter((feature) => feature.free.kind !== 'value').length)
    for (const mark of marks) {
      expect(contrastRatio(glyphColor(mark), paintedBackground(mark))).toBeGreaterThanOrEqual(3)
    }
  },
)

const PORTAL = 'https://billing.example.com/portal'
const RENEWAL = new Date(NOW + 300 * DAY).toISOString()

/** The member view's common parts: the thanks, what Premium includes, and no way to buy. */
async function expectMemberView() {
  await expect.element(headline(ON_PREMIUM)).toBeVisible()
  await expect.element(planSheet().getByText(THANKS)).toBeVisible()
  await expect
    .element(planSheet().getByRole('heading', { level: 3, name: INCLUDED, exact: true }))
    .toBeVisible()
  for (const feature of INCLUDED_FEATURES) {
    await expect.element(planSheet().getByText(feature.title, { exact: true })).toBeVisible()
    await expect.element(planSheet().getByText(feature.detail, { exact: true })).toBeVisible()
  }
  expect(planSheet().getByRole('table').query()).toBeNull()
  expect(planSheet().getByRole('button', { name: SUBSCRIBE }).query()).toBeNull()
  expect(closeControl()).toBe('header')
}

it('a stripe member manages on the web, and the sheet never asks the store for offers', async () => {
  config.portalUrl = PORTAL
  onTestFinished(() => {
    config.portalUrl = ''
  })
  const offers = vi.fn(fakeStore().offers)
  await openPaywall({
    row: { premium_source: 'stripe', premium_expires_at: RENEWAL, auto_renews: true },
    store: fakeStore({ offers }),
    reason: 'plan',
    from: 'plan_group',
  })

  await expectMemberView()
  // The sheet asks for offers as it opens, so by now a paid account would have asked.
  expect(offers).not.toHaveBeenCalled()
  await expect.element(planSheet().getByText(RENEWS, { exact: true })).toBeVisible()
  await expect.element(planSheet().getByText(addedDay(RENEWAL), { exact: true })).toBeVisible()
  const portal = planSheet().getByRole('link', { name: MANAGE_SUBSCRIPTION })
  await expect.element(portal).toHaveAttribute('href', PORTAL)
  await expect.element(portal).toHaveAttribute('target', '_blank')
  await expect.element(portal).toHaveAttribute('rel', 'noopener noreferrer')
})

it('an App Store member manages in App Store settings', async () => {
  await openPaywall({
    row: { premium_source: 'apple', premium_expires_at: RENEWAL, auto_renews: false },
    reason: 'plan',
    from: 'plan_group',
  })

  await expectMemberView()
  await expect.element(planSheet().getByText(ENDS, { exact: true })).toBeVisible()
  await expect.element(planSheet().getByText(addedDay(RENEWAL), { exact: true })).toBeVisible()
  await expect
    .element(planSheet().getByRole('link', { name: MANAGE_APP_STORE }))
    .toHaveAttribute('href', APP_STORE_SUBSCRIPTIONS_URL)
  await expect
    .element(planSheet().getByRole('link', { name: MANAGE_APP_STORE }))
    .toHaveAttribute('target', '_blank')
})

it('the sheet follows the plan while open', async () => {
  const { db } = await openPaywall({ row: PAYWALL_TRIAL, reason: 'plan', from: 'plan_group' })
  await expect.element(planSheet().getByText(PLAN_TRIAL, { exact: true })).toBeVisible()
  await expect.element(planSheet().getByRole('table')).toBeVisible()

  await db.entitlements.put(
    entitlementRow({ premium_source: 'stripe', premium_expires_at: RENEWAL, auto_renews: true }),
  )
  await expectMemberView()
  await expect.element(planSheet().getByText(RENEWS, { exact: true })).toBeVisible()

  // A refund lapses the grant: the account is free, and the sheet sells again.
  await db.entitlements.put(entitlementRow(FREE))
  await expect.element(headline(PREMIUM_PLAN_TITLE)).toBeVisible()
  await expect.element(planSheet().getByRole('table')).toBeVisible()
  expect(planSheet().getByText(THANKS).query()).toBeNull()
})
