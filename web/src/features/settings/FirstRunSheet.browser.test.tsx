import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { INSTRUMENTS } from '../../api/vocabulary'
import type { AuthSession } from '../../auth/AuthContext'
import { setInstruments, settingsId } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import type { SyncEngine } from '../../sync/types'
import { openTestDb } from '../../test/db'
import { stubMediaGlobals } from '../../test/fakeMedia'
import { renderIonic } from '../../test/ionic'
import { fakeEngine, testSession } from '../../test/providers'
import { RecordProvider, useRecord } from '../recording/useRecord'
import { FIRST_RUN_GRACE_MS, FIRST_RUN_HELP, FIRST_RUN_TITLE, FirstRunSheet } from './FirstRunSheet'
import { useSettingsRow } from './useSettingsRow'

vi.mock('./useSettingsRow', { spy: true })
vi.mock('../../commands/settings', { spy: true })

let db: CrosstuneDb
let restoreMedia: (() => void) | null = null

beforeEach(() => {
  db = openTestDb()
  // Real time still drives the clock, so Ionic's animations and Dexie's reads behave as they
  // do in the app; the grace can be jumped forward on top of that.
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(async () => {
  // An automocked module export is not one of the spies restoreMocks puts back on its own.
  vi.mocked(useSettingsRow).mockRestore()
  vi.useRealTimers()
  restoreMedia?.()
  restoreMedia = null
  vi.unstubAllGlobals()
  await db.delete()
})

/** A microphone that refuses, so the record modal settles on a phase with a way out. */
function denyMicrophone() {
  const owned = (['mediaDevices', 'storage'] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(navigator, key)] as const,
  )
  const { getUserMedia } = stubMediaGlobals()
  getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
  restoreMedia = () => {
    for (const [key, descriptor] of owned) {
      if (descriptor) Object.defineProperty(navigator, key, descriptor)
      else Reflect.deleteProperty(navigator, key)
    }
  }
}

const synced = () => fakeEngine({ lastSyncedAt: () => '2026-09-16T12:00:00.000Z' })

function Recording() {
  const { start } = useRecord()
  // Puts the record modal up before the settings row has even been read, so the sheet's silence
  // is decided by the modal rather than by a race with the grace.
  useEffect(() => {
    start()
  }, [start])
  return null
}

function show({
  engine = synced(),
  session = testSession,
  recording = false,
}: { engine?: SyncEngine; session?: AuthSession; recording?: boolean } = {}) {
  return renderIonic(
    <RecordProvider>
      {recording ? <Recording /> : null}
      <FirstRunSheet />
    </RecordProvider>,
    { db, engine, session },
  )
}

const sheet = () => page.getByRole('dialog', { name: FIRST_RUN_TITLE })
const box = (name: string) => page.getByRole('checkbox', { name })
const done = () => page.getByRole('button', { name: 'Done', exact: true })
const stored = async () => (await db.user_settings.get(settingsId('user_1')))?.instruments
const tombstone = async () => (await db.user_settings.get(settingsId('user_1')))?.deleted_at

/**
 * Past the grace. The grace only starts once the live query has delivered the settings row, so
 * the clock is pushed forward in steps: one jump would land before that read and expire nothing.
 */
async function elapse() {
  for (let step = 0; step < 30; step += 1) await vi.advanceTimersByTimeAsync(FIRST_RUN_GRACE_MS / 4)
}

/**
 * Past the grace and past the beat an overlay takes to present. A check taken the instant the
 * grace ends reads an empty page whether or not the sheet was on its way up.
 */
async function settle() {
  await elapse()
  await new Promise((resolve) => setTimeout(resolve, 400))
}

/** A closed Ionic overlay is hidden, so a role query stops finding it once it has gone. */
const gone = (locator: ReturnType<typeof page.getByRole>) =>
  expect.poll(() => locator.elements().length).toBe(0)

describe('FirstRunSheet', () => {
  it('asks the new account which instruments it plays, and saves the answer', async () => {
    show()
    await elapse()
    await expect.element(sheet()).toBeVisible()
    await expect.element(page.getByText(FIRST_RUN_HELP)).toBeVisible()
    await box('Violin').click()
    await done().click()
    await expect.poll(stored).toEqual(['violin'])
    await gone(sheet())
  })

  it('starts with nothing chosen, so an empty answer is stored as an empty answer', async () => {
    show()
    await elapse()
    await expect.element(sheet()).toBeVisible()
    await expect.element(box('Violin')).not.toBeChecked()
    await done().click()
    await expect.poll(stored).toEqual([])
  })

  it('takes another answer when a pull clears the one it stored', async () => {
    show()
    await elapse()
    await expect.element(sheet()).toBeVisible()
    await box('Violin').click()
    await done().click()
    await expect.poll(stored).toEqual(['violin'])
    await gone(sheet())

    // A pull can land a tombstone for the settings row, which leaves no stored answer again.
    await db.user_settings.update(settingsId('user_1'), { deleted_at: '2026-09-17T00:00:00.000Z' })
    await elapse()
    await expect.element(sheet()).toBeVisible()
    // A fresh question, not the last one reopened.
    await expect.element(box('Violin')).not.toBeChecked()
    await done().click()
    // The second answer clears the tombstone the pull left. A Done still held by the first
    // answer would write nothing, and a sheet that refuses dismissal would then have no way out.
    await expect.poll(tombstone).toBeNull()
    await expect.poll(stored).toEqual([])
    await gone(sheet())
  })

  it('asks the next question clean after a refusal, with no alert left over', async () => {
    show()
    await elapse()
    await expect.element(sheet()).toBeVisible()
    vi.mocked(setInstruments).mockRejectedValueOnce(new Error('Settings are read-only'))
    await done().click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('Settings are read-only')

    // A pull can land an answer the sheet never took, which closes the question without the
    // successful write that would have dropped the rejection along the way.
    await setInstruments(db, 'user_1', ['banjo'])
    await expect.poll(stored).toEqual(['banjo'])
    await gone(sheet())

    await db.user_settings.update(settingsId('user_1'), { deleted_at: '2026-09-17T00:00:00.000Z' })
    await elapse()
    await expect.element(sheet()).toBeVisible()
    // The rejection belonged to the question it was given under, so the new one carries the help
    // text the alert replaces rather than an error about an answer nobody has given yet.
    expect(page.getByRole('alert').elements()).toHaveLength(0)
    await expect.element(page.getByText(FIRST_RUN_HELP)).toBeVisible()
  })

  it('waits out the grace again when a pull clears the stored answer', async () => {
    show()
    await elapse()
    await expect.element(sheet()).toBeVisible()
    await done().click()
    await gone(sheet())

    await db.user_settings.update(settingsId('user_1'), { deleted_at: '2026-09-17T00:00:00.000Z' })
    // Short of the grace: a question that kept the grace it already served would be back up.
    await new Promise((resolve) => setTimeout(resolve, FIRST_RUN_GRACE_MS - 150))
    expect(sheet().elements()).toHaveLength(0)
    await elapse()
    await expect.element(sheet()).toBeVisible()
  })

  it('shows the whole question in the title rather than eliding it', async () => {
    show()
    await elapse()
    await expect.element(sheet()).toBeVisible()
    const title = document.querySelector('ion-modal:not(.overlay-hidden) ion-title')!
    // Ionic draws the title inside its shadow root, which is where the clipping would happen.
    const drawn = title.shadowRoot!.querySelector('.toolbar-title')!
    expect(title.textContent).toBe(FIRST_RUN_TITLE)
    expect(drawn.scrollWidth).toBeLessThanOrEqual(drawn.clientWidth + 1)
    expect(drawn.scrollHeight).toBeLessThanOrEqual(drawn.clientHeight + 1)
  })

  it('gives every control in the question a tap target a finger can hit', async () => {
    show()
    await elapse()
    await expect.element(sheet()).toBeVisible()
    const open = document.querySelector('ion-modal:not(.overlay-hidden)')!
    const items = open.querySelectorAll('ion-item')
    expect(items).toHaveLength(INSTRUMENTS.length)
    for (const item of items) {
      expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }
    expect(done().element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  })

  it('writes one answer when Done is pressed twice in the same tick', async () => {
    show()
    await elapse()
    await expect.element(sheet()).toBeVisible()
    const button = done().element() as HTMLElement
    button.click()
    button.click()
    await expect.poll(stored).toEqual([])
    expect(vi.mocked(setInstruments)).toHaveBeenCalledOnce()
  })

  it('refuses every dismissal, since the question has to be answered', async () => {
    show()
    await elapse()
    await expect.element(sheet()).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await settle()
    await expect.element(sheet()).toBeVisible()
  })

  it('stays quiet when the account already answered', async () => {
    await setInstruments(db, 'user_1', ['violin'])
    show()
    await settle()
    expect(sheet().elements()).toHaveLength(0)
  })

  it('stays quiet while the settings row is still being read, answer unknown', async () => {
    // A row that never arrives stands in for a device slow enough that the read outlasts the
    // grace, where an unread row must not be read as an unanswered one.
    vi.mocked(useSettingsRow).mockReturnValue(undefined)
    show()
    await settle()
    expect(sheet().elements()).toHaveLength(0)
  })

  it('stays quiet before the first clean sync, which is what pulls an existing answer', async () => {
    show({ engine: fakeEngine() })
    await settle()
    expect(sheet().elements()).toHaveLength(0)
  })

  it('stays quiet in an offline session, which never syncs', async () => {
    show({ session: { ...testSession, getToken: async () => null, offline: true } })
    await settle()
    expect(sheet().elements()).toHaveLength(0)
  })

  it('stays quiet under the record modal, and asks once the recording is over', async () => {
    denyMicrophone()
    show({ recording: true })
    await expect.element(page.getByRole('dialog', { name: 'New recording' })).toBeVisible()
    await settle()
    expect(sheet().elements()).toHaveLength(0)

    await done().click()
    await gone(page.getByRole('dialog', { name: 'New recording' }))
    await elapse()
    await expect.element(sheet()).toBeVisible()
  })
})
