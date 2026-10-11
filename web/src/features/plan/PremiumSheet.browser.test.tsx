import type { ReactElement } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import { RECORD_LABEL } from '../../app/tabs'
import { destination } from '../../app/destinations'
import { useEntitlement, usePlan } from '../../billing/usePlan'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalEntitlement } from '../../db/types'
import { openTestDb } from '../../test/db'
import { fakeMediaForTest } from '../../test/fakeMedia'
import { renderApp } from '../../test/renderApp'
import { dataProviders } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { entitlementRow, scanRow, tuneRow } from '../../test/rows'
import { Button } from '../../ui/Button'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { NEW_RECORDING } from '../capture/recordCopy'
import { SEARCH_RECORDINGS, UPLOAD_AUDIO } from '../recordings/recordingsCopy'
import { ADD_RECORDING } from '../tune/tuneMediaCopy'
import { TUNE } from '../tune/tunePageCopy'
import {
  PLAN_GROUP,
  PREMIUM_RECORDINGS_BODY,
  PREMIUM_RECORDINGS_TITLE,
  PREMIUM_SCANS_TITLE,
  premiumScansBody,
  SEE_PLAN,
} from './planCopy'
import { PremiumSheetProvider, usePremiumSheet } from './PremiumSheetProvider'

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
