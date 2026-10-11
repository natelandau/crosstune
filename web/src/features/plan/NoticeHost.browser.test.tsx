import { useState, type ReactElement } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { RECORD_LABEL } from '../../app/tabs'
import { seenNotices } from '../../billing/notices'
import type { Store } from '../../billing/store'
import { StoreProvider } from '../../billing/StoreProvider'
import { useEntitlement } from '../../billing/usePlan'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalEntitlement } from '../../db/types'
import { createSyncEngine } from '../../sync/engine'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
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
import { CANCEL } from '../../ui/confirmCopy'
import { Sheet } from '../../ui/Sheet'
import { FixedNow } from '../../ui/useNow'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { noopAnalytics } from '../../usage/client'
import { recordingAnalytics } from '../../usage/testing'
import { NEW_RECORDING, STOP } from '../capture/recordCopy'
import { settingsPagePath } from '../settings/settingsPaths'
import { NoticeHost } from './NoticeHost'
import {
  FIRST_RECORDING_TITLE,
  firstRecordingBody,
  NOTICE_OK,
  TRIAL_ENDED_BODY,
  TRIAL_ENDED_TITLE,
  TRIAL_REMINDER_BODY,
  TRIAL_REMINDER_RECORDINGS,
  trialReminderTitle,
} from './noticeCopy'
import { PREMIUM_RECORDINGS_TITLE, SEE_PLAN, SUBSCRIBE } from './planCopy'
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
        <PremiumSheetProvider navigate={navigate}>
          <FixedNow value={NOW.getTime()}>
            <NoticeHost navigate={navigate} />
            <DueProbe />
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

it('reminds of a trial ending in two days, naming recordings only when the account holds one', async () => {
  const db = openTestDb()
  const ends = new Date(NOW.getTime() + 2 * DAY).toISOString()
  const { analytics } = await mount(db, trialEnding(2 * DAY))

  const notice = dialog(trialReminderTitle(addedDay(ends)))
  await expect.element(notice).toBeVisible()
  await expect.element(notice.getByText(TRIAL_REMINDER_BODY)).toBeVisible()
  await expect.element(notice.getByText(TRIAL_REMINDER_RECORDINGS)).not.toBeInTheDocument()

  await captureRecording(db)
  await expect.element(notice.getByText(TRIAL_REMINDER_RECORDINGS)).toBeVisible()
  await expect
    .poll(() => shown(analytics))
    .toEqual([{ name: 'notice_shown', props: { notice: 'trial_reminder' } }])
})

it('shows the next due notice once the first is dismissed', async () => {
  const db = openTestDb()
  await captureRecording(db)
  const ends = new Date(NOW.getTime() + 2 * DAY).toISOString()
  const { analytics } = await mount(db, trialEnding(2 * DAY))

  const reminder = dialog(trialReminderTitle(addedDay(ends)))
  await reminder.getByRole('button', { name: NOTICE_OK }).click()
  await expect.element(reminder).not.toBeInTheDocument()
  await expect.element(dialog(FIRST_RECORDING_TITLE)).toBeVisible()
  await expect
    .poll(() => shown(analytics).map((send) => send.props))
    .toEqual([{ notice: 'trial_reminder' }, { notice: 'first_recording' }])
})

it('tells a lapsed trial it has ended and opens the Plan group from See your plan', async () => {
  const db = openTestDb()
  const { analytics, navigate } = await mount(db, {
    premium_source: null,
    trial_ends_at: new Date(NOW.getTime() - DAY).toISOString(),
  })

  const notice = dialog(TRIAL_ENDED_TITLE)
  await expect.element(notice).toHaveAccessibleDescription(TRIAL_ENDED_BODY)
  await notice.getByRole('button', { name: SEE_PLAN }).click()

  await expect.element(notice).not.toBeInTheDocument()
  expect(navigate).toHaveBeenCalledWith(settingsPagePath('account'))
  await expect.poll(async () => [...(await seenNotices(db))]).toEqual(['trial_ended'])
  await expect
    .poll(() => shown(analytics))
    .toEqual([{ name: 'notice_shown', props: { notice: 'trial_ended' } }])
})

const sheetShown = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.sends().filter((send) => send.name === 'premium_sheet_shown')

it.each(['trial_reminder', 'trial_ended'] as const)(
  'offers Subscribe on the %s notice, marking it seen and opening the Premium sheet',
  async (kind) => {
    const db = openTestDb()
    const row =
      kind === 'trial_reminder'
        ? trialEnding(2 * DAY)
        : { premium_source: null, trial_ends_at: new Date(NOW.getTime() - DAY).toISOString() }
    const { analytics, navigate } = await mount(db, row, undefined, fakeStore())
    const notice = page.getByRole('dialog').first()
    await expect.element(notice).toBeVisible()
    await expect.element(notice.getByRole('button', { name: NOTICE_OK })).toBeVisible()
    await notice.getByRole('button', { name: SUBSCRIBE }).click()

    await expect
      .poll(() => sheetShown(analytics))
      .toEqual([{ name: 'premium_sheet_shown', props: { reason: 'plan', from: kind } }])
    await expect.poll(async () => [...(await seenNotices(db))]).toEqual([kind])
    expect(navigate).not.toHaveBeenCalled()
  },
)

it('keeps See your plan on a notice when no store is configured', async () => {
  const db = openTestDb()
  await mount(db, trialEnding(2 * DAY))
  const notice = page.getByRole('dialog').first()
  await expect.element(notice.getByRole('button', { name: SEE_PLAN })).toBeVisible()
  expect(notice.getByRole('button', { name: SUBSCRIBE }).elements()).toHaveLength(0)
})

it('keeps See your plan on the first-recording notice even with a store', async () => {
  const db = openTestDb()
  await captureRecording(db)
  await mount(db, trialEnding(10 * DAY), undefined, fakeStore())
  const notice = dialog(FIRST_RECORDING_TITLE)
  await expect.element(notice.getByRole('button', { name: SEE_PLAN })).toBeVisible()
  expect(notice.getByRole('button', { name: SUBSCRIBE }).elements()).toHaveLength(0)
})

it('takes Escape as OK', async () => {
  const db = openTestDb()
  await mount(db, {
    premium_source: null,
    trial_ends_at: new Date(NOW.getTime() - DAY).toISOString(),
  })
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

/** As the app nests them: the Premium sheet renders after its children, so its claim registers
 * after the host's layout effects in a commit they share. */
function SameCommitPremium() {
  const [now, setNow] = useState(NOW.getTime())
  return (
    <FixedNow value={now}>
      <PremiumSheetProvider navigate={() => {}}>
        <PremiumOpener onPress={() => setNow(NOW.getTime() + 2.5 * DAY)} />
        <NoticeHost navigate={() => {}} />
        <DueProbe />
      </PremiumSheetProvider>
    </FixedNow>
  )
}

it('waits for a Premium sheet that opened in the same commit the notice fell due', async () => {
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

  const premium = dialog(PREMIUM_RECORDINGS_TITLE)
  await expect.element(premium).toBeVisible()
  await expect.element(due()).toHaveTextContent('trial_reminder')
  const reminder = dialog(
    trialReminderTitle(addedDay(new Date(NOW.getTime() + 5 * DAY).toISOString())),
  )
  await expect.element(reminder).not.toBeInTheDocument()

  await premium.getByRole('button', { name: CANCEL }).click()
  await expect.element(reminder).toBeVisible()
})
