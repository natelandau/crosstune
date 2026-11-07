import { act } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import { destination } from '../../layout/destinations'
import { recordingPath } from '../../layout/tuneHome'
import { openTestDb } from '../../test/db'
import { planSheet } from '../../test/planSheet'
import { fakePlaybackEngine } from '../../test/providers'
import { entitlementRow, recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { renderApp } from '../../test/renderApp'
import { PHONE, WIDE } from '../../test/practice'
import { TAB_BAR } from '../../layout/tabs'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import { recordingAnalytics } from '../../usage/testing'
import { NEXT_TUNE, PLAYER_REGION } from '../player/playerCopy'
import {
  CLOSE_PLAYER,
  OPEN_RECORDING,
  PAUSE,
  PLAY,
  PROGRESS,
  REPEAT_LOOP,
} from '../player/transportCopy'
import { loopName } from '../../domain/loopModel'
import { LOOPS_LABEL, MODES_LABEL, WAVEFORM_LABEL } from '../practice/practiceCopy'
import { WAVEFORM_SLOT_PX } from '../practice/PracticeSurface'
import { SUBSCRIBE_TO_PLAY } from '../recordings/recordingCopy'
import { GO_TO_TUNE, playName } from '../recordings/recordingNames'
import { TUNE } from '../tune/tunePageCopy'
import { liveLoops } from '../../test/recordings'
import { practice, press, waveform } from '../../test/practice'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { MAX_RECORDING_MS } from '../../domain/recordingLimits'
import { NEW_TUNE_PATH } from '../../layout/tuneHome'
import { SPLIT } from '../practice/splitCopy'
import { TRIM } from '../practice/trimCopy'
import { START_HANDLE } from '../practice/TrimStrip'
import { CANCEL } from '../../ui/confirmCopy'
import { PRACTICE as PRACTICE_BUTTON } from '../tune/tuneActionsCopy'
import { DETAILS, PRACTICE } from './recordingPageCopy'
import { entryOf } from './recordingPageState'
import { OFFLINE } from '../../sync/labels'
import { PLAYERS_LABEL } from '../recordings/recordingsCopy'

const TUNE_PATH = '/catalog/t1'
const RECORDINGS = destination('recordings')
const FAST = 'Fast version'
const SLOW = 'Slow version'

/** A tune with two minute-long recordings this device holds. */
async function seed(db: CrosstuneDb) {
  await db.tunes.put(tuneRow('t1', 'Old Joe Clark'))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
  for (const [id, label, position] of [
    ['rA', FAST, 0],
    ['rB', SLOW, 1],
  ] as const) {
    await db.recordings.put(
      recordingRow(id, {
        tune_id: 't1',
        label,
        position,
        duration_ms: 60_000,
        source_duration_ms: 60_000,
      }),
    )
    await db.recording_files.put(
      recordingFile(id, {
        blob: new Blob(['x'], { type: 'audio/mp4' }),
        local_duration_ms: 60_000,
      }),
    )
  }
}

async function mount(
  path: string,
  frame = PHONE,
  {
    lapsed = false,
    analytics = recordingAnalytics(),
    before,
  }: {
    lapsed?: boolean
    analytics?: ReturnType<typeof recordingAnalytics>
    /** Changes the seeded rows before the app renders. */
    before?: (db: CrosstuneDb) => Promise<unknown>
  } = {},
) {
  const db = openTestDb()
  await seed(db)
  await before?.(db)
  if (lapsed) await db.entitlements.put(entitlementRow())
  const engine = fakePlaybackEngine()
  const { router } = await renderApp({
    path,
    db,
    frame,
    playbackEngine: engine,
    wrap: (app) => <AnalyticsProvider client={analytics}>{app}</AnalyticsProvider>,
  })
  return { db, engine, router, analytics }
}

const more = () => page.getByRole('main').getByRole('button', { name: MORE_ACTIONS })
const tab = (name: string) => page.getByRole('tab', { name, exact: true })
const showDetails = async () => {
  await tab(DETAILS).click()
  await expect.element(tab(DETAILS)).toHaveAttribute('aria-selected', 'true')
}
const heading = (name: string) => page.getByRole('heading', { level: 1, name, exact: true })
const dock = () => page.getByRole('region', { name: PLAYER_REGION })
/**
 * Counts the copies a closing dock leaves sliding out over the page, each a fixed, inert
 * element on the body, from now until the test ends, since one leaves again once it has slid.
 */
function watchDockGhosts(): () => number {
  let ghosts = 0
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (
          node instanceof HTMLElement &&
          node.inert &&
          node.getAttribute('aria-hidden') === 'true' &&
          node.style.position === 'fixed'
        )
          ghosts++
  })
  observer.observe(document.body, { childList: true })
  onTestFinished(() => observer.disconnect())
  return () => ghosts
}
const detailsPlay = () =>
  page.getByRole('tabpanel', { name: DETAILS }).getByRole('button', { name: PLAY, exact: true })
const detailsPause = () =>
  page.getByRole('tabpanel', { name: DETAILS }).getByRole('button', { name: PAUSE, exact: true })
const rowPlay = (label: string) =>
  page
    .getByRole('main', { name: TUNE })
    .getByRole('row', { name: new RegExp(label) })
    .first()
    .getByRole('button', { name: playName(label), exact: true })
const planSheetShown = (analytics: ReturnType<typeof recordingAnalytics>) =>
  analytics.sends().filter((send) => send.name === 'premium_sheet_shown')
const PAGE_PLAN_SHEET = {
  name: 'premium_sheet_shown',
  props: { reason: 'recordings', from: 'recording_page' },
}

/** Plays `label` from its row's play control on the tune page. */
async function playFromRow(label: string) {
  await rowPlay(label).click()
  await expect.element(dock()).toBeVisible()
}

it('compact: lists Practice first and opens on it, never on the tab used last', async () => {
  const { router } = await mount(recordingPath(TUNE_PATH, 'rA'))
  await expect.element(tab(PRACTICE)).toHaveAttribute('aria-selected', 'true')
  const names = () =>
    [...document.querySelectorAll('[role="tab"]')].map((element) => element.textContent)
  await expect.poll(names).toEqual([PRACTICE, DETAILS])
  await showDetails()

  await act(() => router.navigate(TUNE_PATH))
  await expect.element(tab(PRACTICE)).not.toBeInTheDocument()
  await act(() => router.navigate(recordingPath(TUNE_PATH, 'rA')))
  await expect.element(tab(PRACTICE)).toHaveAttribute('aria-selected', 'true')
})

it('wide: shows practice with the attributes column and no tabs', async () => {
  await mount(recordingPath(TUNE_PATH, 'rA'), WIDE)
  await expect.element(page.getByRole('complementary', { name: DETAILS })).toBeVisible()
  await expect.element(page.getByRole('tablist')).not.toBeInTheDocument()
  await expect.poll(() => document.querySelector('[data-practice-waveform]')).not.toBeNull()
})

it('folds to tabs when its column is narrow', async () => {
  // The widest content column leaves the detail column too narrow for practice beside it.
  localStorage.setItem('crosstune.columnWidth', '480')
  await mount(recordingPath(TUNE_PATH, 'rA'), { width: 1100, height: 800 })
  await expect.element(tab(DETAILS)).toBeVisible()
  await expect.element(page.getByRole('complementary', { name: DETAILS })).not.toBeInTheDocument()
})

it('opening a page leaves playback alone', async () => {
  const { router, engine } = await mount(TUNE_PATH, WIDE)
  await playFromRow(FAST)
  await expect.poll(() => engine.getState().playing).toBe(true)

  await act(() => router.navigate(recordingPath(TUNE_PATH, 'rB')))
  await expect.element(heading(SLOW)).toBeVisible()
  await expect.element(dock().getByRole('button', { name: OPEN_RECORDING(FAST) })).toBeVisible()
  await expect.poll(() => engine.getState().playing).toBe(true)
})

it("writes the play of what plays while another recording's wide page shows", async () => {
  const realNow = Date.now.bind(Date)
  let aheadMs = 0
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + aheadMs)
  onTestFinished(() => clock.mockRestore())
  const { db, router, engine } = await mount(TUNE_PATH, WIDE)
  await playFromRow(FAST)
  await expect.poll(() => engine.getState().playing).toBe(true)

  await act(() => router.navigate(recordingPath(TUNE_PATH, 'rB')))
  await waveformScaled()
  aheadMs += 20_000
  await dock().getByRole('button', { name: CLOSE_PLAYER }).click()

  await expect
    .poll(async () => (await db.play_events.toArray()).map((play) => play.recording_id))
    .toEqual(['rA'])
})

it("reports a play from the Details tab's play bar as from the recording's page", async () => {
  const { analytics, engine, router } = await mount(recordingPath(TUNE_PATH, 'rA'))
  await showDetails()
  await detailsPlay().click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await act(() => router.navigate(TUNE_PATH))
  await expect
    .poll(() =>
      analytics
        .sends()
        .filter((send) => send.name === 'playback_ended')
        .map((send) => (send.props as { source: string }).source),
    )
    .toEqual(['recording_screen'])
})

it('plays on Details with no dock, and stops once the page goes', async () => {
  const { engine, router } = await mount(recordingPath(TUNE_PATH, 'rA'))
  await showDetails()
  await detailsPlay().click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await expect.element(detailsPause()).toBeVisible()
  await expect.element(dock()).not.toBeInTheDocument()
  // No list plays, so the play bar has no list controls.
  await expect
    .element(page.getByRole('tabpanel', { name: DETAILS }).getByRole('button', { name: NEXT_TUNE }))
    .not.toBeInTheDocument()

  const ghosts = watchDockGhosts()
  await act(() => router.navigate(TUNE_PATH))
  await expect.element(rowPlay(FAST)).toBeVisible()
  await expect.poll(() => engine.getState().playing).toBe(false)
  await expect.element(dock()).not.toBeInTheDocument()
  // A dock that never showed slides nothing out as the playback stops.
  expect(ghosts()).toBe(0)
})

it('stops its playback when Go to tune leaves the page', async () => {
  const { engine, router } = await mount(recordingPath(TUNE_PATH, 'rA'), WIDE)
  await page.getByRole('main').getByRole('button', { name: PLAY, exact: true }).click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  const ghosts = watchDockGhosts()
  await more().click()
  await page.getByRole('menuitem', { name: GO_TO_TUNE }).click()
  await expect.poll(() => router.state.location.pathname).toBe(TUNE_PATH)
  await expect.poll(() => engine.getState().playing).toBe(false)
  await expect.element(rowPlay(FAST)).toBeVisible()
  await expect.element(dock()).not.toBeInTheDocument()
  expect(ghosts()).toBe(0)
})

it('stops its playback when another tab opens', async () => {
  const { engine } = await mount(recordingPath(TUNE_PATH, 'rA'))
  await showDetails()
  await detailsPlay().click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await page
    .getByRole('navigation', { name: TAB_BAR })
    .getByRole('link', { name: RECORDINGS.label })
    .click()
  await expect.element(heading(FAST)).not.toBeInTheDocument()
  await expect.poll(() => engine.getState().playing).toBe(false)
  await expect.element(dock()).not.toBeInTheDocument()
})

it('keeps its playback with no dock across a tab switch, Trim, and the fold', async () => {
  // The widest content column folds the page at 1100 px and leaves it wide at 1600 px.
  localStorage.setItem('crosstune.columnWidth', '480')
  const { engine } = await mount(recordingPath(TUNE_PATH, 'rA'), { width: 1100, height: 800 })
  await tab(PRACTICE).click()
  await page
    .getByRole('tabpanel', { name: PRACTICE })
    .getByRole('button', { name: PLAY, exact: true })
    .click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await expect.element(dock()).not.toBeInTheDocument()
  // An unload counts as a load, so an unchanged count says the recording stayed loaded.
  const loads = engine.loads

  await tab(DETAILS).click()
  await expect.element(detailsPause()).toBeVisible()

  await more().click()
  await page.getByRole('menuitem', { name: TRIM }).click()
  await expect.element(page.getByRole('slider', { name: START_HANDLE })).toBeVisible()
  await expect.element(dock()).not.toBeInTheDocument()
  await page.getByRole('dialog', { name: TRIM }).getByRole('button', { name: CANCEL }).click()
  await expect.element(heading(FAST)).toBeVisible()

  await page.viewport(1600, 800)
  await expect.element(page.getByRole('complementary', { name: DETAILS })).toBeVisible()
  await page.viewport(1100, 800)
  await expect.element(tab(DETAILS)).toBeVisible()
  await expect.element(dock()).not.toBeInTheDocument()
  expect(engine.loads).toBe(loads)
  expect(engine.getState().lengthMs).toBeGreaterThan(0)
})

it("hides the dock on the page of a row's playback, and plays on with the dock after it", async () => {
  const { engine, router } = await mount(TUNE_PATH)
  await playFromRow(FAST)
  await expect.poll(() => engine.getState().playing).toBe(true)

  await act(() => router.navigate(recordingPath(TUNE_PATH, 'rA')))
  await expect.element(heading(FAST)).toBeVisible()
  await showDetails()
  await expect.element(dock()).not.toBeInTheDocument()
  await expect.element(detailsPause()).toBeVisible()
  // Pausing and resuming on the page leaves the playback the row's.
  await detailsPause().click()
  await detailsPlay().click()
  await expect.poll(() => engine.getState().playing).toBe(true)

  await act(() => router.navigate(TUNE_PATH))
  await expect.element(dock().getByRole('button', { name: OPEN_RECORDING(FAST) })).toBeVisible()
  await expect.poll(() => engine.getState().playing).toBe(true)
})

it("expand opens the loaded recording's page on Practice", async () => {
  const { router } = await mount(TUNE_PATH)
  await playFromRow(SLOW)
  await dock()
    .getByRole('button', { name: OPEN_RECORDING(SLOW) })
    .click()
  await expect.poll(() => router.state.location.pathname).toBe(recordingPath(TUNE_PATH, 'rB'))
  await expect.element(tab(PRACTICE)).toHaveAttribute('aria-selected', 'true')
})

it('leaves when the recording is deleted', async () => {
  const { db, router } = await mount(recordingPath(RECORDINGS.root, 'rA'))
  await expect.element(heading(FAST)).toBeVisible()
  await db.recordings.update('rA', { deleted_at: '2026-02-01T00:00:00.000Z' })
  await expect.poll(() => router.state.location.pathname).toBe(RECORDINGS.root)
})

it("a lapsed account's page edits but does not play", async () => {
  const { analytics } = await mount(recordingPath(TUNE_PATH, 'rA'), PHONE, { lapsed: true })
  const details = page.getByRole('tabpanel', { name: DETAILS })
  await expect.element(details.getByRole('button', { name: PLAY, exact: true })).toBeDisabled()
  await expect.element(tab(PRACTICE)).toHaveAttribute('aria-disabled', 'true')
  await details.getByRole('button', { name: SUBSCRIBE_TO_PLAY }).click()
  await expect.element(planSheet()).toBeVisible()
  await expect.poll(() => planSheetShown(analytics)).toEqual([PAGE_PLAN_SHEET])
})

it('offline, with no audio on this device, edits but shows why it cannot play', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const { db } = await mount(recordingPath(TUNE_PATH, 'rA'), PHONE, {
    before: (db) => db.recording_files.update('rA', { blob: undefined }),
  })
  await showDetails()
  const details = page.getByRole('tabpanel', { name: DETAILS })
  await details.getByRole('button', { name: new RegExp(`^${PLAYERS_LABEL}, `) }).click()
  await page
    .getByRole('dialog', { name: PLAYERS_LABEL })
    .getByRole('combobox', { name: PLAYERS_LABEL })
    .fill('Offline player')
  await userEvent.keyboard('{Enter}')
  await expect.poll(async () => (await db.recordings.get('rA'))?.players).toBe('Offline player')
  await expect.element(details.getByRole('button', { name: PLAY, exact: true })).toBeDisabled()
  await expect.element(details.getByRole('status')).toHaveTextContent(OFFLINE)

  await tab(PRACTICE).click()
  const practice = page.getByRole('tabpanel', { name: PRACTICE })
  await expect
    .element(practice.getByRole('button', { name: PLAY, exact: true }))
    .toHaveAttribute('aria-disabled', 'true')
  await expect.element(practice.getByText(OFFLINE, { exact: true })).toBeVisible()
})

it('keeps the place scrubbed on Details when Practice shows', async () => {
  await mount(recordingPath(TUNE_PATH, 'rA'))
  await showDetails()
  const scrubber = page
    .getByRole('tabpanel', { name: DETAILS })
    .getByRole('slider', { name: PROGRESS(FAST) })
  await expect.element(scrubber).toBeEnabled()
  ;(scrubber.element() as HTMLElement).focus()
  await userEvent.keyboard('{ArrowRight}{ArrowRight}')
  await expect.element(scrubber).toHaveValue('10000')
  await tab(PRACTICE).click()
  await expect
    .element(page.getByRole('slider', { name: WAVEFORM_LABEL }))
    .toHaveAttribute('aria-valuenow', '10000')
})

it('back returns to the list it came from', async () => {
  const { router } = await mount(RECORDINGS.root)
  await act(() => router.navigate(recordingPath(RECORDINGS.root, 'rA')))
  await expect.element(heading(FAST)).toBeVisible()
  await page.getByRole('main').getByRole('link', { name: RECORDINGS.label, exact: true }).click()
  await expect.poll(() => router.state.location.pathname).toBe(RECORDINGS.root)
  expect(router.state.historyAction).toBe('POP')
})

it('sends recording_page_opened with the layout', async () => {
  const { analytics } = await mount(recordingPath(RECORDINGS.root, 'rA'))
  const opened = () => analytics.sends().filter((send) => send.name === 'recording_page_opened')
  await expect.poll(opened).toEqual([
    {
      name: 'recording_page_opened',
      props: { recording_id: 'rA', layout: 'practice', source: 'recordings_list' },
    },
  ])
  await showDetails()
  await expect.poll(opened).toHaveLength(1)
})

/** Plays `label` from its row on the tune page, at its own speed and pitch. */
async function playAtItsSettings(engine: ReturnType<typeof fakePlaybackEngine>) {
  await playFromRow(FAST)
  await expect.poll(() => engine.getState().playing).toBe(true)
  await expect.poll(() => engine.getState().speedPercent).toBe(80)
  await expect.poll(() => engine.getState().pitchCents).toBe(-200)
}

const fastAtItsSettings = (db: CrosstuneDb) =>
  db.recordings.update('rA', { speed_percent: 80, pitch_cents: -200 })

it("trims another recording's page without touching what plays", async () => {
  const { router, engine } = await mount(TUNE_PATH, WIDE, { before: fastAtItsSettings })
  await playAtItsSettings(engine)
  await act(() => router.navigate(recordingPath(TUNE_PATH, 'rB')))
  await more().click()
  await page.getByRole('menuitem', { name: TRIM }).click()
  await expect.element(page.getByRole('slider', { name: START_HANDLE })).toBeVisible()
  await expect.element(dock().getByRole('button', { name: OPEN_RECORDING(FAST) })).toBeVisible()
  await expect.poll(() => engine.getState().speedPercent).toBe(80)
  await expect.poll(() => engine.getState().pitchCents).toBe(-200)

  await page.getByRole('dialog', { name: TRIM }).getByRole('button', { name: CANCEL }).click()
  await expect.element(heading(SLOW)).toBeVisible()
  await expect.poll(() => engine.getState().speedPercent).toBe(80)
  await expect.poll(() => engine.getState().pitchCents).toBe(-200)
  await expect.poll(() => engine.getState().playing).toBe(true)
})

it('splits a recording that must be split to upload without touching what plays', async () => {
  const long = MAX_RECORDING_MS + 60_000
  const { engine } = await mount(TUNE_PATH, WIDE, {
    before: async (db) => {
      await fastAtItsSettings(db)
      await db.recordings.update('rB', { duration_ms: long, source_duration_ms: long })
      await db.recording_files.update('rB', { local_duration_ms: long })
    },
  })
  await playAtItsSettings(engine)
  await page
    .getByRole('main', { name: TUNE })
    .getByRole('row', { name: new RegExp(SLOW) })
    .first()
    .getByText(SLOW, { exact: true })
    .click()
  await expect.element(heading(SLOW)).toBeVisible()
  await more().click()
  await page.getByRole('menuitem', { name: SPLIT }).click()
  await expect.element(page.getByRole('dialog', { name: SPLIT })).toBeVisible()
  await expect.element(dock().getByRole('button', { name: OPEN_RECORDING(FAST) })).toBeVisible()
  await expect.poll(() => engine.getState().speedPercent).toBe(80)
  await expect.poll(() => engine.getState().pitchCents).toBe(-200)
  await expect.poll(() => engine.getState().playing).toBe(true)
})

it('folds by its own width in the split frame', async () => {
  await mount(recordingPath(TUNE_PATH, 'rA'), { width: 1050, height: 800 })
  await expect.element(page.getByRole('complementary', { name: DETAILS })).toBeVisible()
  await expect.element(page.getByRole('tablist')).not.toBeInTheDocument()
})

/** A row of the catalog list beside the page, holding focus. */
async function focusCatalogRow() {
  const row = page.getByRole('region', { name: destination('catalog').label }).getByRole('row')
  await expect.element(row.first()).toBeVisible()
  const element = row.first().element() as HTMLElement
  element.focus()
  await expect.poll(() => document.activeElement).toBe(element)
}

it('leaves a key pressed in the list beside it to the list', async () => {
  const { db } = await mount(recordingPath(TUNE_PATH, 'rA'), WIDE)
  await expect
    .poll(() => document.querySelector<HTMLElement>('[data-practice-waveform]')?.dataset.pxPerS)
    .toBeTruthy()
  press('n')
  await expect.poll(async () => (await liveLoops(db, 'rA')).length).toBe(1)
  await focusCatalogRow()
  await userEvent.keyboard('{Delete}')
  await userEvent.keyboard('{Escape}')
  await expect.poll(async () => (await liveLoops(db, 'rA')).length).toBe(1)
})

it('leaves Delete and digits pressed on an attribute row to the row', async () => {
  const { db } = await mount(recordingPath(TUNE_PATH, 'rA'), WIDE)
  await waveformScaled()
  press('n')
  // Shows once the new loop is selected and read, which Delete and the digits act on.
  await expect
    .element(page.getByRole('button', { name: REPEAT_LOOP(loopName(null, 0, 0)), exact: true }))
    .toBeVisible()
  const row = page
    .getByRole('complementary', { name: DETAILS })
    .getByRole('button', { name: new RegExp(`^${PLAYERS_LABEL}, `) })
    .element() as HTMLElement
  const pressOn = (target: Element, key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    target.dispatchEvent(event)
    return event.defaultPrevented
  }
  // Practice takes a key it acts on, so a key it leaves alone is never prevented.
  expect(pressOn(row, 'Delete')).toBe(false)
  expect(pressOn(row, '1')).toBe(false)
  expect(pressOn(document.body, 'Delete')).toBe(true)
  await expect.poll(async () => (await liveLoops(db, 'rA')).length).toBe(0)
})

it("lets N from the list beside it reach the app's new tune", async () => {
  const { db, router } = await mount(recordingPath(TUNE_PATH, 'rA'), WIDE)
  await expect.poll(() => document.querySelector('[data-practice-waveform]')).not.toBeNull()
  await focusCatalogRow()
  await userEvent.keyboard('n')
  await expect.poll(() => router.state.location.pathname).toBe(NEW_TUNE_PATH)
  expect(await liveLoops(db, 'rA')).toHaveLength(0)
})

it('back from a tune shown in Recordings returns to that tune', async () => {
  const { router } = await mount(`${RECORDINGS.root}/t1`)
  await page.getByRole('button', { name: PRACTICE_BUTTON, exact: true }).click()
  await expect.poll(() => router.state.location.pathname).toBe(recordingPath(RECORDINGS.root, 'rA'))
  await page.getByRole('main').getByRole('link', { name: 'Old Joe Clark', exact: true }).click()
  await expect.poll(() => router.state.location.pathname).toBe(`${RECORDINGS.root}/t1`)
  expect(router.state.historyAction).toBe('POP')
})

it('back still returns to the tune in Recordings after its row reopens the page', async () => {
  const { router } = await mount(`${RECORDINGS.root}/t1`, WIDE)
  await page.getByRole('button', { name: PRACTICE_BUTTON, exact: true }).click()
  await expect.poll(() => router.state.location.pathname).toBe(recordingPath(RECORDINGS.root, 'rA'))
  await page
    .getByRole('row', { name: new RegExp(FAST) })
    .first()
    .getByText(FAST, { exact: true })
    .click()
  await expect.poll(() => router.state.historyAction).toBe('REPLACE')
  // Wide shows no Back, so the entry's own record of where Back goes stands in for it.
  expect(entryOf(router.state.location.state).from).toBe(`${RECORDINGS.root}/t1`)
})

it('back onto the page neither reports it again nor reopens the tab its opener asked for', async () => {
  const { router, analytics } = await mount(TUNE_PATH)
  await playFromRow(SLOW)
  await dock()
    .getByRole('button', { name: OPEN_RECORDING(SLOW) })
    .click()
  await expect.element(tab(PRACTICE)).toHaveAttribute('aria-selected', 'true')
  const opened = () => analytics.sends().filter((send) => send.name === 'recording_page_opened')
  await expect.poll(opened).toHaveLength(1)

  await act(() => router.navigate(-1))
  await expect.element(tab(PRACTICE)).not.toBeInTheDocument()
  await act(() => router.navigate(1))
  await expect.element(tab(PRACTICE)).toHaveAttribute('aria-selected', 'true')
  await expect.poll(opened).toHaveLength(1)
})

const waveformScaled = () =>
  expect
    .poll(() => document.querySelector<HTMLElement>('[data-practice-waveform]')?.dataset.pxPerS)
    .toBeTruthy()

const pxPerS = () => document.querySelector<HTMLElement>('[data-practice-waveform]')?.dataset.pxPerS
const repeatNewLoop = () =>
  page.getByRole('button', { name: REPEAT_LOOP(loopName(null, 0, 0)), exact: true })

const modeRadio = (name: string) =>
  page.getByRole('radiogroup', { name: MODES_LABEL }).getByRole('radio', { name, exact: true })

/** Zooms practice in and selects a new loop, and returns the zoomed scale. */
async function zoomAndSelectLoop(): Promise<string | undefined> {
  await waveformScaled()
  const opened = pxPerS()
  press('=', { metaKey: true })
  await expect.poll(pxPerS).not.toBe(opened)
  press('n')
  await expect.element(repeatNewLoop()).toBeVisible()
  return pxPerS()
}

it('keeps the zoom and the selected loop from Practice to Details and back', async () => {
  await mount(recordingPath(TUNE_PATH, 'rA'))
  await tab(PRACTICE).click()
  await modeRadio(LOOPS_LABEL).click()
  const zoomed = await zoomAndSelectLoop()
  await tab(DETAILS).click()
  await expect.element(tab(DETAILS)).toHaveAttribute('aria-selected', 'true')
  await tab(PRACTICE).click()
  await expect.element(repeatNewLoop()).toBeVisible()
  await expect.poll(pxPerS).toBe(zoomed)
  await expect.element(modeRadio(LOOPS_LABEL)).toBeChecked()
})

it("leaves practice's keys alone while Details shows", async () => {
  await mount(recordingPath(TUNE_PATH, 'rA'))
  await tab(PRACTICE).click()
  await waveformScaled()
  await tab(DETAILS).click()
  const scrubber = page
    .getByRole('tabpanel', { name: DETAILS })
    .getByRole('slider', { name: PROGRESS(FAST) })
  await expect.element(scrubber).toBeEnabled()
  expect(press('ArrowRight').defaultPrevented).toBe(false)
  await expect.element(scrubber).toHaveValue('0')
})

it('keeps the zoom, the selected loop, and the playhead across the fold', async () => {
  // The widest content column folds the page at 1100 px and leaves it wide at 1600 px.
  localStorage.setItem('crosstune.columnWidth', '480')
  await mount(recordingPath(TUNE_PATH, 'rA'), { width: 1100, height: 800 })
  await tab(PRACTICE).click()
  await modeRadio(LOOPS_LABEL).click()
  const zoomed = await zoomAndSelectLoop()
  const playhead = page.getByRole('slider', { name: WAVEFORM_LABEL })
  press('ArrowRight')
  await expect.element(playhead).not.toHaveAttribute('aria-valuenow', '0')
  const at = playhead.element().getAttribute('aria-valuenow')

  await page.viewport(1600, 800)
  await expect.element(page.getByRole('complementary', { name: DETAILS })).toBeVisible()
  await expect.element(repeatNewLoop()).toBeVisible()
  await expect.element(playhead).toHaveAttribute('aria-valuenow', at)

  await page.viewport(1100, 800)
  await expect.element(tab(PRACTICE)).toHaveAttribute('aria-selected', 'true')
  await expect.element(repeatNewLoop()).toBeVisible()
  await expect.element(playhead).toHaveAttribute('aria-valuenow', at)
  await expect.poll(pxPerS).toBe(zoomed)
  await expect.element(modeRadio(LOOPS_LABEL)).toBeChecked()
})

it('opens a page on Speed after Loops was used on the last one', async () => {
  const { router } = await mount(recordingPath(TUNE_PATH, 'rA'))
  await tab(PRACTICE).click()
  await modeRadio(LOOPS_LABEL).click()
  await expect.element(modeRadio(LOOPS_LABEL)).toBeChecked()
  await act(() => router.navigate(recordingPath(TUNE_PATH, 'rB')))
  await expect.element(tab(PRACTICE)).toBeVisible()
  await tab(PRACTICE).click()
  await expect.element(modeRadio('Speed')).toBeChecked()
})

it("hears practice's keys at once after the dock's Expand opens it", async () => {
  const { db, router } = await mount(TUNE_PATH, WIDE)
  await playFromRow(SLOW)
  await dock()
    .getByRole('button', { name: OPEN_RECORDING(SLOW) })
    .click()
  await waveformScaled()
  await userEvent.keyboard('n')
  await expect.poll(async () => (await liveLoops(db, 'rB')).length).toBe(1)
  expect(router.state.location.pathname).toBe(recordingPath(TUNE_PATH, 'rB'))
})

it("hears practice's keys after a press on the Practice tab", async () => {
  const { db, router } = await mount(recordingPath(TUNE_PATH, 'rA'))
  await tab(PRACTICE).click()
  await waveformScaled()
  await userEvent.keyboard('n')
  await expect.poll(async () => (await liveLoops(db, 'rA')).length).toBe(1)
  expect(router.state.location.pathname).toBe(recordingPath(TUNE_PATH, 'rA'))
})

it("says Subscribe to play once on a lapsed account's wide page", async () => {
  const { analytics } = await mount(recordingPath(TUNE_PATH, 'rA'), WIDE, { lapsed: true })
  const main = page.getByRole('main')
  await expect.element(main.getByRole('button', { name: SUBSCRIBE_TO_PLAY })).toBeVisible()
  await expect.poll(() => main.getByText(SUBSCRIBE_TO_PLAY).elements()).toHaveLength(1)
  await main.getByRole('button', { name: SUBSCRIBE_TO_PLAY }).click()
  await expect.element(planSheet()).toBeVisible()
  await expect.poll(() => planSheetShown(analytics)).toEqual([PAGE_PLAN_SHEET])
})

it('opens wide straight into its layout, never drawing the tabs first', async () => {
  let tabsDrawn = false
  // Read from the added nodes, since tabs drawn and replaced in one task are gone by the time
  // the observer runs.
  const observer = new MutationObserver((records) => {
    for (const node of records.flatMap((record) => [...record.addedNodes])) {
      if (!(node instanceof Element)) continue
      if (node.matches('[role="tablist"]') || node.querySelector('[role="tablist"]')) {
        tabsDrawn = true
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  onTestFinished(() => observer.disconnect())
  await mount(recordingPath(TUNE_PATH, 'rA'), WIDE)
  await expect.element(page.getByRole('complementary', { name: DETAILS })).toBeVisible()
  await waveformScaled()
  const shown = document.querySelector('[data-practice-waveform]')
  await expect.element(page.getByRole('heading', { level: 1, name: FAST })).toBeVisible()
  expect(tabsDrawn).toBe(false)
  expect(document.querySelector('[data-practice-waveform]')).toBe(shown)
})

/** How far practice's dark surface stops above the bottom of the pane area it shows in. */
function gapUnderPractice(): number | undefined {
  const surface = practice()
  const scroller = surface?.closest<HTMLElement>('[data-pane-scroller]')
  if (!surface || !scroller) return undefined
  const clearance = parseFloat(getComputedStyle(scroller).getPropertyValue('--float-clearance'))
  const areaBottom = scroller.getBoundingClientRect().bottom - (clearance || 0)
  return Math.round(areaBottom - surface.getBoundingClientRect().bottom)
}

const waveformHeight = () => waveform()?.getBoundingClientRect().height

it('wide: fills the page down to its bottom with the waveform at one height', async () => {
  await mount(recordingPath(TUNE_PATH, 'rA'), { width: 1440, height: 900 })
  await waveformScaled()
  await expect.poll(gapUnderPractice).toBe(0)
  await expect.poll(waveformHeight).toBe(WAVEFORM_SLOT_PX)

  await page.viewport(1440, 1400)
  await expect.poll(gapUnderPractice).toBe(0)
  await expect.poll(waveformHeight).toBe(WAVEFORM_SLOT_PX)
})

it('compact: fills the Practice tab down to the page bottom', async () => {
  await mount(recordingPath(TUNE_PATH, 'rA'), { width: 390, height: 1200 })
  await tab(PRACTICE).click()
  await waveformScaled()
  await expect.poll(gapUnderPractice).toBe(0)
  await expect.poll(waveformHeight).toBe(WAVEFORM_SLOT_PX)
})
