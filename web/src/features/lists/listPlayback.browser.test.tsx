import { page, userEvent } from 'vitest/browser'
import { expect, it } from 'vitest'
import { AnalyticsProvider } from '../../usage/AnalyticsProvider'
import type { AnalyticsClient } from '../../usage/client'
import { recordingAnalytics } from '../../usage/testing'
import { RECORD_LABEL } from '../../app/tabs'
import { NEW_RECORDING } from '../capture/recordCopy'
import type { CrosstuneDb } from '../../db/schema'
import type { LocalList, LocalListItem } from '../../db/types'
import {
  NOTHING_PLAYS,
  SHUFFLE,
  SKIP_LINKS_ONLY,
  WHAT_PLAYS_HINT,
  WHAT_PLAYS_LEAD,
  WHAT_PLAYS_TITLE,
  willPlayLabel,
} from './listPlayCopy'
import {
  listPosition,
  NEXT_TUNE,
  NOTHING_LEFT,
  PLAYER_REGION,
  PREVIOUS_TUNE,
  REPEAT_LIST,
  REPEAT_OFF,
  REPEAT_TUNE,
} from '../player/playerCopy'
import { CLOSE_PLAYER, OPEN_RECORDING, PAUSE, PLAY } from '../player/transportCopy'
import {
  SAVE_TRIM,
  TRIM_CHANGED_ELSEWHERE,
  TRIM_CONFIRM_ACTION,
  TRIM_CONFIRM_TITLE,
} from '../practice/trimViewCopy'
import { TRIM } from '../practice/trimCopy'
import { START_HANDLE } from '../practice/TrimStrip'
import { playName } from '../recordings/recordingNames'
import { openTestDb } from '../../test/db'
import { fakeMediaForTest } from '../../test/fakeMedia'
import { FakeAudioElement, fakePlaybackEngine } from '../../test/providers'
import { linkRow, recordingFile, recordingRow, tuneRow, userTuneRow } from '../../test/rows'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { EDIT, RECORDING_NAME_LABEL } from '../recordings/recordingCopy'
import { EDIT_RECORDING_TITLE, SAVE_RECORDING } from '../recordings/recordingsCopy'

import { press } from '../../test/practice'
import { renderApp } from '../../test/renderApp'
import { TUNE_LIST, SELECT_TUNES } from '../catalog/catalogCopy'

const PHONE = { width: 390, height: 844 }
const WIDE = { width: 1280, height: 800 }
const AT = '2026-01-01T00:00:00.000Z'

const TITLES = { t1: 'Old Joe Clark', t2: 'Forked Deer', t3: "Soldier's Joy" } as const
type TuneId = keyof typeof TITLES

/** How each tune of Thursday jam plays: a take this device holds, a take only the server
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
  const line = page.getByRole('button', { name: willPlayLabel(2, 3) })
  await expect.element(line).toBeVisible()
  await expect.element(line).toHaveAccessibleDescription(WHAT_PLAYS_HINT)
})

it('says what plays and opens a skipped tune from the sheet', async () => {
  const { router } = await mount(WIDE, ONE_LINK)
  await page.getByRole('button', { name: willPlayLabel(2, 3) }).click()
  const sheet = page.getByRole('dialog', { name: WHAT_PLAYS_TITLE })
  await expect.element(sheet.getByText(WHAT_PLAYS_LEAD)).toBeVisible()
  const group = sheet.getByRole('region', { name: SKIP_LINKS_ONLY })
  const tune = group.getByRole('button', { name: TITLES.t2 })
  await expect.element(tune).toBeVisible()
  await expect.element(group.getByRole('button', { name: TITLES.t1 })).not.toBeInTheDocument()
  await tune.click()
  await expect.element(sheet).not.toBeInTheDocument()
  await expect.poll(() => router.state.location.pathname).toBe('/lists/l1/tunes/t2')
})

it('plays the list from its first tune', async () => {
  await mount(WIDE, ONE_LINK)
  await startList()
  await expect.element(row('t3')).not.toHaveAttribute('data-playing')
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
  const practice = page.getByRole('dialog', { name: `${TITLES.t1} take` })
  for (const name of [SHUFFLE, PREVIOUS_TUNE, NEXT_TUNE, REPEAT_OFF]) {
    await expect.element(practice.getByRole('button', { name })).toBeVisible()
  }
  await practice.getByRole('button', { name: NEXT_TUNE }).click()
  await expect.element(page.getByRole('dialog', { name: `${TITLES.t3} take` })).toBeVisible()
})

/** The list playing on the phone, with full-screen practice open on its first take. */
async function phonePractice(
  media: Record<TuneId, Media> = ALL_HELD,
  options: { download?: () => Promise<Blob | null> } = {},
) {
  const app = await mount(PHONE, media, options)
  await startList()
  await player()
    .getByRole('button', { name: OPEN_RECORDING(take('t1')) })
    .click()
  await expect.element(page.getByRole('dialog', { name: take('t1') })).toBeVisible()
  return app
}

const subtitle = () =>
  document.querySelector('[data-practice] [data-recording-subtitle]')?.textContent

it("reads the list's place under the title in phone practice, with no header skips", async () => {
  const { engine } = await phonePractice()
  await expect.poll(subtitle).toBe(listPosition('Thursday jam', 1, 3))
  const header = page.getByRole('dialog').getByRole('banner')
  expect(header.getByRole('button', { name: NEXT_TUNE }).query()).toBeNull()
  await page.getByRole('dialog').getByRole('button', { name: NEXT_TUNE }).click()
  await expect.poll(subtitle).toBe(listPosition('Thursday jam', 2, 3))
  // Practice has read the next take and its audio plays, so nothing is left writing.
  await expect.element(page.getByRole('dialog', { name: take('t2') })).toBeVisible()
  await expect.poll(() => engine.getState().playing).toBe(true)
})

it('keeps focus on Next tune in phone practice as the list moves on', async () => {
  await phonePractice()
  const next = page.getByRole('dialog').getByRole('button', { name: NEXT_TUNE })
  await next.click()
  await expect.element(page.getByRole('dialog', { name: take('t2') })).toBeVisible()
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe(NEXT_TUNE)
  await next.click()
  await expect.element(page.getByRole('dialog', { name: take('t3') })).toBeVisible()
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe(NEXT_TUNE)
})

it('keeps focus on Play in phone practice when a tune ends and the list moves on', async () => {
  const { endTune } = await phonePractice()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: PAUSE }).click()
  await dialog.getByRole('button', { name: PLAY, exact: true }).click()
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe(PAUSE)
  endTune()
  await expect.element(page.getByRole('dialog', { name: take('t2') })).toBeVisible()
  await expect
    .poll(() => document.activeElement?.closest('[data-focus-key]')?.getAttribute('data-focus-key'))
    .toBe('play')
})

/** Phone practice whose second take only the server holds, its download held until
 * `release`, playing the first take with focus on Pause. */
async function heldPhonePractice() {
  let land: (blob: Blob) => void = () => {}
  const held = new Promise<Blob | null>((resolve) => {
    land = resolve
  })
  const app = await phonePractice(
    { t1: 'held', t2: 'server', t3: 'held' },
    { download: () => held },
  )
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: PAUSE }).click()
  await dialog.getByRole('button', { name: PLAY, exact: true }).click()
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe(PAUSE)
  /** The download lands, storing the take's audio as the sync engine does. */
  const release = async () => {
    const blob = new Blob(['x'], { type: 'audio/mp4' })
    await app.db.recording_files.put(recordingFile('r-t2', { blob, local_duration_ms: 3000 }))
    land(blob)
  }
  return { ...app, release }
}

const focusKey = () =>
  document.activeElement?.closest('[data-focus-key]')?.getAttribute('data-focus-key')

/** Where focus sits after each change to the page and each move of focus, until `stop`. */
function watchFocus() {
  const seen: string[] = []
  const note = () => {
    const focused = document.activeElement
    seen.push(
      !focused || focused === document.body
        ? 'body'
        : (focusKey() ?? focused.getAttribute('aria-label') ?? focused.tagName),
    )
  }
  const observer = new MutationObserver(note)
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('focusin', note)
  return {
    seen,
    stop: () => {
      observer.disconnect()
      document.removeEventListener('focusin', note)
    },
  }
}

it('holds focus on Play in phone practice while the next take loads', async () => {
  const { engine, endTune, release } = await heldPhonePractice()
  const focus = watchFocus()
  endTune()
  await expect.element(page.getByRole('dialog', { name: take('t2') })).toBeVisible()
  await expect.poll(focusKey).toBe('play')
  focus.stop()
  expect(focus.seen.length).toBeGreaterThan(0)
  expect(focus.seen.filter((place) => place !== 'play')).toEqual([])
  await release()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe(PAUSE)
})

it('leaves phone practice open when Space is pressed while the next take loads', async () => {
  const { engine, endTune, release } = await heldPhonePractice()
  endTune()
  const next = page.getByRole('dialog', { name: take('t2') })
  await expect.element(next).toBeVisible()
  // Space reaches whatever holds focus, so it must be Play, which ignores it, and not Close.
  await expect.poll(focusKey).toBe('play')
  await userEvent.keyboard(' ')
  expect(focusKey()).toBe('play')
  expect(engine.getState().playing).toBe(false)
  await release()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe(PAUSE)
  await expect.element(next).toBeVisible()
})

it('leaves focus where it was moved while the next take loads in phone practice', async () => {
  const { engine, endTune, release } = await heldPhonePractice()
  endTune()
  await expect.element(page.getByRole('dialog', { name: take('t2') })).toBeVisible()
  await userEvent.keyboard('{Tab}')
  await expect.poll(focusKey).not.toBe('play')
  const moved = document.activeElement
  await release()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await expect.element(page.getByRole('dialog').getByRole('button', { name: PAUSE })).toBeVisible()
  expect(document.activeElement).toBe(moved)
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

it('disables Play and Shuffle when nothing in the list can play', async () => {
  await mount(WIDE, { t1: 'none', t2: 'link', t3: 'none' })
  await expect.element(page.getByRole('button', { name: NOTHING_PLAYS })).toBeVisible()
  await expect.element(playButton()).toBeDisabled()
  await expect.element(shuffleButton()).toBeDisabled()
})

it('says nothing is left on the bar when no tune can be fetched after Play', async () => {
  await mount(WIDE, { t1: 'server', t2: 'server', t3: 'link' }, { download: async () => null })
  await expect.element(page.getByRole('button', { name: willPlayLabel(2, 3) })).toBeVisible()
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

it('says nothing is left on the phone bar, and Close clears it', async () => {
  await mount(PHONE, { t1: 'server', t2: 'server', t3: 'link' }, { download: async () => null })
  await expect.element(page.getByRole('button', { name: willPlayLabel(2, 3) })).toBeVisible()
  await playButton().click()
  const bar = player()
  await expect.element(bar.getByText(NOTHING_LEFT)).toBeVisible()
  await bar.getByRole('button', { name: CLOSE_PLAYER }).click()
  await expect.element(bar).not.toBeInTheDocument()
})

it('clears what the stopped list said once a take starts', async () => {
  fakeMediaForTest()
  await mount(WIDE, { t1: 'server', t2: 'server', t3: 'link' }, { download: async () => null })
  await expect.element(page.getByRole('button', { name: willPlayLabel(2, 3) })).toBeVisible()
  await playButton().click()
  await expect.element(player().getByText(NOTHING_LEFT)).toBeVisible()
  await page.getByRole('button', { name: RECORD_LABEL }).click()
  await expect.element(page.getByRole('dialog', { name: NEW_RECORDING })).toBeVisible()
  // Behind the sheet too, so the bar never comes back saying it once the take is done.
  await expect.poll(() => document.body.textContent?.includes(NOTHING_LEFT)).toBe(false)
})

it('disables Play and Shuffle while a take records', async () => {
  fakeMediaForTest()
  await mount(WIDE, ONE_LINK)
  await expect.element(playButton()).toBeEnabled()
  await page.getByRole('button', { name: RECORD_LABEL }).click()
  // The list sits inert behind the record sheet.
  const hidden = { exact: true, includeHidden: true }
  await expect.element(page.getByRole('button', { name: PLAY, ...hidden })).toBeDisabled()
  await expect.element(page.getByRole('button', { name: SHUFFLE, ...hidden })).toBeDisabled()
})

const take = (id: TuneId) => `${TITLES[id]} take`

/** Practice on the list's first take, opened from the dock, then Trim from More. */
async function openTrim(engine: ReturnType<typeof fakePlaybackEngine>) {
  await player()
    .getByRole('button', { name: OPEN_RECORDING(take('t1')) })
    .click()
  const practice = page.getByRole('dialog', { name: take('t1') })
  await practice.getByRole('button', { name: MORE_ACTIONS }).click()
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
  engine.seek(1000)
  press('[')
  await expect.element(start).toHaveAttribute('aria-valuenow', '1000')
  endTune()
  const trim = page.getByRole('dialog', { name: TRIM })
  await trim.getByRole('button', { name: SAVE_TRIM }).click()
  const question = page.getByRole('alertdialog', { name: TRIM_CONFIRM_TITLE(2000) })
  await question.getByRole('button', { name: TRIM_CONFIRM_ACTION }).click()
  await expect.poll(async () => (await db.recordings.get('r-t1'))?.trim_start_ms).toBe(1000)
  expect((await db.recordings.get('r-t2'))?.trim_start_ms).toBe(0)
  // Back in practice on the same take: had the list moved on, practice would have closed.
  await expect
    .element(
      page.getByRole('dialog', { name: take('t1') }).getByRole('button', { name: MORE_ACTIONS }),
    )
    .toBeVisible()
  await expect.element(row('t1', { includeHidden: true })).toHaveAttribute('data-playing')
})

it('holds the list at the end of a tune whose Edit sheet is open, keeping what was typed', async () => {
  const { db, engine, endTune } = await mount(WIDE, ALL_HELD)
  await startList()
  await player()
    .getByRole('button', { name: OPEN_RECORDING(take('t1')) })
    .click()
  const practice = page.getByRole('dialog', { name: take('t1') })
  await expect.poll(() => engine.getState().playing).toBe(true)
  await practice.getByRole('button', { name: MORE_ACTIONS }).click()
  await page.getByRole('menuitem', { name: EDIT }).click()
  const sheet = page.getByRole('dialog', { name: EDIT_RECORDING_TITLE })
  const name = sheet.getByRole('textbox', { name: RECORDING_NAME_LABEL })
  await expect.element(name).toHaveValue(take('t1'))
  await name.fill('Slow take')
  endTune()
  // The end has reached the engine, so the list has had its chance to move on.
  await expect.poll(() => engine.getState().playing).toBe(false)
  await expect.element(name).toHaveValue('Slow take')
  await sheet.getByRole('button', { name: SAVE_RECORDING }).click()
  await expect.poll(async () => (await db.recordings.get('r-t1'))?.label).toBe('Slow take')
  const held = page.getByRole('dialog', { name: 'Slow take' })
  await expect.element(held).toBeVisible()
  // Next lands on the second tune only if the end did not already move the list on.
  await held.getByRole('button', { name: NEXT_TUNE }).click()
  await expect.element(page.getByRole('dialog', { name: take('t2') })).toBeVisible()
})

it('follows a playing list in practice without carrying over what it said', async () => {
  const { db, engine, endTune } = await mount(WIDE, ALL_HELD)
  await startList()
  await openTrim(engine)
  await db.recordings.update('r-t1', { trim_start_ms: 500 })
  const first = page.getByRole('dialog', { name: take('t1') })
  await expect.element(first.getByText(TRIM_CHANGED_ELSEWHERE)).toBeVisible()
  endTune()
  const second = page.getByRole('dialog', { name: take('t2') })
  await expect.element(second).toBeVisible()
  await expect.element(second.getByText(TRIM_CHANGED_ELSEWHERE)).not.toBeInTheDocument()
})
