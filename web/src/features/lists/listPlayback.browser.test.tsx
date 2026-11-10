import { page, userEvent } from 'vitest/browser'
import { expect, it } from 'vitest'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import type { AnalyticsClient } from '../../usage/client'
import { recordingAnalytics } from '../../usage/testing'
import { RECORD_LABEL } from '../../layout/tabs'
import { NEW_RECORDING } from '../capture/recordCopy'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList, LocalListItem } from '../../db/types'
import { NOTHING_PLAYS, SHUFFLE, willPlayLabel } from './listPlayCopy'
import {
  NEXT_TUNE,
  NOTHING_LEFT,
  PLAYER_REGION,
  PREVIOUS_TUNE,
  REPEAT_LIST,
  REPEAT_OFF,
  REPEAT_TUNE,
} from '../player/playerCopy'
import { CLOSE_PLAYER, OPEN_RECORDING, PAUSE, PLAY } from '../player/transportCopy'
import { SAVE_TRIM, TRIM_CONFIRM_ACTION, TRIM_CONFIRM_TITLE } from '../practice/trimViewCopy'
import { TRIM } from '../practice/trimCopy'
import { START_HANDLE } from '../practice/TrimStrip'
import { pauseName, playName } from '../recordings/recordingNames'
import { openTestDb } from '../../test/db'
import { fakeMediaForTest } from '../../test/fakeMedia'
import { FakeAudioElement, fakePlaybackEngine } from '../../test/providers'
import {
  entitlementRow,
  linkRow,
  recordingFile,
  recordingRow,
  tuneRow,
  userTuneRow,
} from '../../test/rows'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { RECORDING_NAME_LABEL } from '../recordings/recordingCopy'
import { NAME_LABEL } from '../recordings/recordingsCopy'

import { renderApp } from '../../test/renderApp'
import { recordingPage } from '../../test/practice'
import { PRACTICE as PRACTICE_TAB } from '../recording/recordingPageCopy'
import { TUNE_LIST, SELECT_TUNES } from '../catalog/catalogCopy'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
const AT = '2026-01-01T00:00:00.000Z'

const TITLES = { t1: 'Old Joe Clark', t2: 'Forked Deer', t3: "Soldier's Joy" } as const
type TuneId = keyof typeof TITLES

/** How each tune of Thursday jam plays: a recording this device holds, a recording only the server
 * holds, a link only, or nothing at all. */
type Media = 'held' | 'server' | 'link' | 'none'

async function seed(db: CrosstuneDb, media: Record<TuneId, Media>) {
  const row = { created_at: AT, updated_at: AT, deleted_at: null, server_seq: 0 }
  const list: LocalList = { id: 'l1', ...row, name: 'Thursday jam', position: 0 }
  const ids = Object.keys(TITLES) as TuneId[]
  for (const [position, id] of ids.entries()) {
    await db.tunes.put(tuneRow(id, TITLES[id]))
    await db.user_tunes.put(userTuneRow(`u-${id}`, id))
    const item: LocalListItem = {
      id: `i-${id}`,
      ...row,
      list_id: 'l1',
      user_tune_id: `u-${id}`,
      position,
    }
    await db.list_items.put(item)
    const kind = media[id]
    if (kind === 'held' || kind === 'server') {
      await db.recordings.put(
        recordingRow(`r-${id}`, {
          tune_id: id,
          label: `${TITLES[id]} take`,
          duration_ms: 3000,
          source_duration_ms: 3000,
        }),
      )
      if (kind === 'held') {
        await db.recording_files.put(
          recordingFile(`r-${id}`, {
            blob: new Blob(['x'], { type: 'audio/mp4' }),
            local_duration_ms: 3000,
          }),
        )
      }
    }
    if (kind === 'link') await db.recording_links.put(linkRow(`k-${id}`, id))
  }
  await db.lists.put(list)
}

const ONE_LINK: Record<TuneId, Media> = { t1: 'held', t2: 'link', t3: 'held' }
const ALL_HELD: Record<TuneId, Media> = { t1: 'held', t2: 'held', t3: 'held' }

async function mount(
  frame: { width: number; height: number },
  media: Record<TuneId, Media>,
  {
    download,
    analytics,
    before,
  }: {
    download?: () => Promise<Blob | null>
    analytics?: AnalyticsClient
    /** Changes the seeded rows before the app renders. */
    before?: (db: CrosstuneDb) => Promise<unknown>
  } = {},
) {
  const db = openTestDb()
  await seed(db, media)
  await before?.(db)
  const element = new FakeAudioElement()
  const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
  const app = await renderApp({
    path: '/lists/l1',
    db,
    frame,
    playbackEngine: engine,
    sync: download ? { download } : undefined,
    wrap: analytics
      ? (tree) => <AnalyticsProvider client={analytics}>{tree}</AnalyticsProvider>
      : undefined,
  })
  /** The loaded tune plays to its end. */
  const endTune = () => element.dispatchEvent(new Event('ended'))
  return { ...app, db, engine, endTune }
}

const player = () => page.getByRole('region', { name: PLAYER_REGION })
const row = (id: TuneId, options: { includeHidden?: boolean } = {}) =>
  page
    .getByRole('grid', { name: TUNE_LIST, ...options })
    .getByRole('row', { name: new RegExp(TITLES[id]), ...options })
const playButton = () => page.getByRole('button', { name: PLAY, exact: true })
const shuffleButton = () => page.getByRole('button', { name: SHUFFLE, exact: true })

async function startList() {
  await expect.element(playButton()).toBeEnabled()
  await playButton().click()
  await expect.element(row('t1')).toHaveAttribute('data-playing')
}

it('offers Play and Shuffle over how many tunes will play', async () => {
  await mount(WIDE, ONE_LINK)
  await expect.element(playButton()).toBeEnabled()
  await expect.element(shuffleButton()).toBeEnabled()
  await expect.element(page.getByText(willPlayLabel(2, 3), { exact: true })).toBeVisible()
})

it('shows how many tunes will play as plain text, not a button', async () => {
  await mount(WIDE, ONE_LINK)
  const line = page.getByText(willPlayLabel(2, 3), { exact: true })
  await expect.element(line).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: willPlayLabel(2, 3) }))
    .not.toBeInTheDocument()
  expect(line.element().closest('button, [role="button"]')).toBeNull()
})

it('plays nothing on a free plan and says no tune can play', async () => {
  await mount(WIDE, ONE_LINK, { before: (db) => db.entitlements.put(entitlementRow()) })
  await expect.element(page.getByText(NOTHING_PLAYS, { exact: true })).toBeVisible()
  await expect.element(playButton()).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: NOTHING_PLAYS })).not.toBeInTheDocument()
})

/** Starts the list, moves it on to its third tune, and seeks into that tune. */
async function playThirdTune(engine: ReturnType<typeof fakePlaybackEngine>) {
  await startList()
  await expect.poll(() => engine.getState().playing).toBe(true)
  const firstLoads = engine.loads
  await row('t3')
    .getByRole('button', { name: playName(TITLES.t3) })
    .click()
  await expect.element(row('t3')).toHaveAttribute('data-playing')
  // The row marks the tune before its audio loads, and the load resets the position, so the
  // seek waits for it.
  await expect.poll(() => engine.loads).toBeGreaterThan(firstLoads)
  await expect.poll(() => engine.getState().playing).toBe(true)
  engine.seek(1500)
  await expect.poll(() => engine.getState().positionMs).toBe(1500)
  return engine.loads
}

/** The list still plays its third tune from where it was paused, with no reload. */
async function resumedThirdTune(engine: ReturnType<typeof fakePlaybackEngine>, loads: number) {
  await expect.poll(() => engine.getState()).toMatchObject({ playing: true, positionMs: 1500 })
  expect(engine.loads).toBe(loads)
  await expect.element(row('t3')).toHaveAttribute('data-playing')
  await expect.element(row('t1')).not.toHaveAttribute('data-playing')
}

it("pauses and resumes the playing list from the list's own Play", async () => {
  const { engine } = await mount(PHONE, ALL_HELD)
  const loads = await playThirdTune(engine)
  // The page, apart from the player bar's own Play and Pause.
  const listPage = () => page.getByRole('main')
  await listPage().getByRole('button', { name: PAUSE, exact: true }).click()
  await expect.poll(() => engine.getState().playing).toBe(false)
  await expect.element(row('t3')).toHaveAttribute('data-playing')
  await listPage().getByRole('button', { name: PLAY, exact: true }).click()
  await resumedThirdTune(engine, loads)
  await expect.element(listPage().getByRole('button', { name: PAUSE, exact: true })).toBeVisible()
})

it('pauses and resumes the playing tune from its play slot', async () => {
  const { engine } = await mount(WIDE, ALL_HELD)
  const loads = await playThirdTune(engine)
  const pause = row('t3').getByRole('button', { name: pauseName(TITLES.t3) })
  await expect.element(pause).toBeEnabled()
  await pause.click()
  await expect.poll(() => engine.getState().playing).toBe(false)
  const resume = row('t3').getByRole('button', { name: playName(TITLES.t3) })
  await expect.element(resume).toBeEnabled()
  await resume.click()
  await resumedThirdTune(engine, loads)
  // Still the queue, so its controls stay on the dock.
  await expect.element(player().getByRole('button', { name: NEXT_TUNE })).toBeVisible()
})

it('steps through the list from the dock', async () => {
  await mount(WIDE, ONE_LINK)
  await startList()
  const dock = player()
  await expect.element(dock.getByRole('button', { name: SHUFFLE })).toBeVisible()
  await expect.element(dock.getByRole('button', { name: PREVIOUS_TUNE })).toBeVisible()
  await expect.element(dock.getByRole('button', { name: REPEAT_OFF })).toBeVisible()
  await dock.getByRole('button', { name: NEXT_TUNE }).click()
  // The link-only tune is not in the queue, so the next tune is the third row.
  await expect.element(row('t3')).toHaveAttribute('data-playing')
  await expect.element(row('t1')).not.toHaveAttribute('data-playing')
})

it('marks Shuffle pressed while the queue is shuffled', async () => {
  await mount(WIDE, ONE_LINK)
  await startList()
  const shuffle = player().getByRole('button', { name: SHUFFLE })
  await expect.element(shuffle).toHaveAttribute('aria-pressed', 'false')
  await shuffle.click()
  await expect.element(shuffle).toHaveAttribute('aria-pressed', 'true')
})

it('cycles Repeat through its modes', async () => {
  await mount(WIDE, ONE_LINK)
  await startList()
  const dock = player()
  await expect
    .element(dock.getByRole('button', { name: REPEAT_OFF }))
    .toHaveAttribute('aria-pressed', 'false')
  await dock.getByRole('button', { name: REPEAT_OFF }).click()
  await expect
    .element(dock.getByRole('button', { name: REPEAT_LIST }))
    .toHaveAttribute('aria-pressed', 'true')
  await dock.getByRole('button', { name: REPEAT_LIST }).click()
  await expect
    .element(dock.getByRole('button', { name: REPEAT_TUNE }))
    .toHaveAttribute('aria-pressed', 'true')
  await dock.getByRole('button', { name: REPEAT_TUNE }).click()
  await expect.element(dock.getByRole('button', { name: REPEAT_OFF })).toBeVisible()
})

it('keeps the queue controls off the phone bar and in practice', async () => {
  await mount(PHONE, ONE_LINK)
  await startList()
  const bar = player()
  // The queue commits before it loads its first tune, so the row's mark means the list is
  // live, and the bar's Pause means the bar has drawn for it.
  await expect.element(bar.getByRole('button', { name: PAUSE })).toBeVisible()
  for (const name of [SHUFFLE, PREVIOUS_TUNE, NEXT_TUNE, REPEAT_OFF]) {
    expect(bar.getByRole('button', { name }).query()).toBeNull()
  }
  await bar.getByRole('button', { name: OPEN_RECORDING(`${TITLES.t1} take`) }).click()
  const practice = recordingPage()
  for (const name of [SHUFFLE, PREVIOUS_TUNE, NEXT_TUNE, REPEAT_OFF]) {
    await expect.element(practice.getByRole('button', { name })).toBeVisible()
  }
  await practice.getByRole('button', { name: NEXT_TUNE }).click()
  await expect
    .element(bar.getByRole('button', { name: OPEN_RECORDING(`${TITLES.t3} take`) }))
    .toBeVisible()
  // The page belongs to the recording it opened on, not to what the list plays next.
  await expect
    .element(practice.getByRole('heading', { level: 1 }))
    .toHaveTextContent(`${TITLES.t1} take`)
})

it('jumps to a tune whose play control is tapped while the list plays', async () => {
  await mount(WIDE, ALL_HELD)
  await startList()
  await row('t3')
    .getByRole('button', { name: playName(TITLES.t3) })
    .click()
  await expect.element(row('t3')).toHaveAttribute('data-playing')
  await expect.element(row('t1')).not.toHaveAttribute('data-playing')
  // Still the queue, so its controls stay on the dock.
  await expect.element(player().getByRole('button', { name: NEXT_TUNE })).toBeVisible()
})

it('plays a tapped tune alone when no list plays', async () => {
  await mount(WIDE, ALL_HELD)
  await row('t2')
    .getByRole('button', { name: playName(TITLES.t2) })
    .click()
  await expect.element(row('t2')).toHaveAttribute('data-playing')
  // The dock has drawn for the tune, so any list controls would be there by now.
  await expect.element(player().getByRole('button', { name: PAUSE })).toBeVisible()
  expect(player().getByRole('button', { name: NEXT_TUNE }).query()).toBeNull()
})

it('a single play from a list row is queue single with list_id', async () => {
  const analytics = recordingAnalytics()
  await mount(WIDE, ONE_LINK, {
    analytics,
    before: (db) =>
      db.recording_links.put(
        linkRow('k-t2', 't2', {
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          provider: 'youtube',
          provider_ref: 'dQw4w9WgXcQ',
        }),
      ),
  })
  await row('t2')
    .getByRole('button', { name: playName(TITLES.t2) })
    .click()
  await expect.element(row('t2')).toHaveAttribute('data-playing')
  await player().getByRole('button', { name: CLOSE_PLAYER }).click()

  await expect
    .poll(() => analytics.sends())
    .toEqual([
      {
        name: 'playback_ended',
        props: {
          source: 'list',
          queue: 'single',
          trigger: 'tap',
          kind: 'link',
          service: 'youtube',
          ended_by: 'closed',
          system_controlled: false,
          tune_id: 't2',
          link_id: 'k-t2',
          list_id: 'l1',
        },
      },
    ])
})

it('leaves out Play and Shuffle when nothing in the list can play', async () => {
  await mount(WIDE, { t1: 'none', t2: 'link', t3: 'none' })
  await expect.element(page.getByText(NOTHING_PLAYS, { exact: true })).toBeVisible()
  await expect.element(playButton()).not.toBeInTheDocument()
  await expect.element(shuffleButton()).not.toBeInTheDocument()
})

it('says nothing is left on the bar when no tune can be fetched after Play', async () => {
  await mount(WIDE, { t1: 'server', t2: 'server', t3: 'link' }, { download: async () => null })
  await expect.element(page.getByText(willPlayLabel(2, 3), { exact: true })).toBeVisible()
  await playButton().click()
  const bar = player()
  await expect.element(bar.getByText(NOTHING_LEFT)).toBeVisible()
  expect(bar.getByRole('button', { name: NEXT_TUNE }).query()).toBeNull()
  await bar.getByRole('button', { name: CLOSE_PLAYER }).click()
  await expect.element(bar).not.toBeInTheDocument()
})

it('hides the play row while selecting', async () => {
  await mount(WIDE, ONE_LINK)
  await expect.element(playButton()).toBeVisible()
  await page.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: SELECT_TUNES }).click()
  await expect.element(playButton()).not.toBeInTheDocument()
  await expect.element(shuffleButton()).not.toBeInTheDocument()
})

it('hides the play row for an empty list', async () => {
  const { db } = await mount(WIDE, ONE_LINK)
  await expect.element(playButton()).toBeVisible()
  await db.list_items.clear()
  await expect.element(playButton()).not.toBeInTheDocument()
})

it('clears what the stopped list said once a recording starts', async () => {
  fakeMediaForTest()
  await mount(WIDE, { t1: 'server', t2: 'server', t3: 'link' }, { download: async () => null })
  await expect.element(page.getByText(willPlayLabel(2, 3), { exact: true })).toBeVisible()
  await playButton().click()
  await expect.element(player().getByText(NOTHING_LEFT)).toBeVisible()
  await page.getByRole('button', { name: RECORD_LABEL }).click()
  await expect.element(page.getByRole('dialog', { name: NEW_RECORDING })).toBeVisible()
  // Behind the sheet too, so the bar never comes back saying it once the recording is done.
  await expect.poll(() => document.body.textContent?.includes(NOTHING_LEFT)).toBe(false)
})

it('disables Play and Shuffle while a recording is under way', async () => {
  fakeMediaForTest()
  await mount(WIDE, ONE_LINK)
  await expect.element(playButton()).toBeEnabled()
  await page.getByRole('button', { name: RECORD_LABEL }).click()
  // The list sits inert behind the record sheet.
  const hidden = { exact: true, includeHidden: true }
  await expect.element(page.getByRole('button', { name: PLAY, ...hidden })).toBeDisabled()
  await expect.element(page.getByRole('button', { name: SHUFFLE, ...hidden })).toBeDisabled()
})

const recordingLabel = (id: TuneId) => `${TITLES[id]} take`

/** Practice on the list's first recording, opened from the dock, then Trim from More. */
async function openTrim(engine: ReturnType<typeof fakePlaybackEngine>) {
  await player()
    .getByRole('button', { name: OPEN_RECORDING(recordingLabel('t1')) })
    .click()
  await recordingPage().getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: TRIM }).click()
  const start = page.getByRole('dialog', { name: TRIM }).getByRole('slider', { name: START_HANDLE })
  await expect.element(start).toBeVisible()
  await expect.poll(() => engine.getState().lengthMs).toBeGreaterThan(0)
  return start
}

it('holds the list at the end of a tune being trimmed, and saves its own trim', async () => {
  const { db, engine, endTune } = await mount(WIDE, ALL_HELD)
  await startList()
  const start = await openTrim(engine)
  engine.pause()
  ;(start.element() as HTMLElement).focus()
  await userEvent.keyboard('{PageUp}')
  await expect.element(start).toHaveAttribute('aria-valuenow', '1000')
  endTune()
  const trim = page.getByRole('dialog', { name: TRIM })
  await trim.getByRole('button', { name: SAVE_TRIM }).click()
  const question = page.getByRole('alertdialog', { name: TRIM_CONFIRM_TITLE(2000) })
  await question.getByRole('button', { name: TRIM_CONFIRM_ACTION }).click()
  await expect.poll(async () => (await db.recordings.get('r-t1'))?.trim_start_ms).toBe(1000)
  expect((await db.recordings.get('r-t2'))?.trim_start_ms).toBe(0)
  // Back on the recording's page, with the list still held on the trimmed tune.
  await expect.element(recordingPage().getByRole('button', { name: MORE_ACTIONS })).toBeVisible()
  await expect.element(row('t1', { includeHidden: true })).toHaveAttribute('data-playing')
})

it('keeps what was typed in the Name editor as the list moves on', async () => {
  const { db, engine, endTune } = await mount(WIDE, ALL_HELD)
  await startList()
  await player()
    .getByRole('button', { name: OPEN_RECORDING(recordingLabel('t1')) })
    .click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await recordingPage()
    .getByRole('button', { name: `${NAME_LABEL}, ${recordingLabel('t1')}`, exact: true })
    .click()
  const editor = page.getByRole('dialog', { name: NAME_LABEL })
  const name = editor.getByRole('textbox', { name: RECORDING_NAME_LABEL })
  await expect.element(name).toHaveValue(recordingLabel('t1'))
  await name.fill('Slow take')
  endTune()
  await expect
    .element(player().getByRole('button', { name: OPEN_RECORDING(recordingLabel('t2')) }))
    .toBeVisible()
  await expect.element(name).toHaveValue('Slow take')
  await userEvent.keyboard('{Enter}')
  await expect.poll(async () => (await db.recordings.get('r-t1'))?.label).toBe('Slow take')
  await expect
    .element(recordingPage().getByRole('heading', { level: 1 }))
    .toHaveTextContent('Slow take')
})

it("leaves the list's controls out of practice for a recording the list is not playing", async () => {
  const { router } = await mount(PHONE, ALL_HELD)
  await startList()
  await router.navigate('/lists/l1/tunes/t2/recordings/r-t2')
  await recordingPage().getByRole('tab', { name: PRACTICE_TAB }).click()
  await expect.poll(() => document.querySelector('[data-practice-transport]')).not.toBeNull()
  expect(recordingPage().getByRole('button', { name: NEXT_TUNE }).query()).toBeNull()
})
