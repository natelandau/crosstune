import { page } from 'vitest/browser'
import { afterAll, expect, it, onTestFinished, vi, type Mock } from 'vitest'
import { RecordLauncherContext, type RecordLauncher } from '../../app/recordLauncher'
import { createTune } from '../../commands/tunes'
import type { Provider, RecordingState } from '../../api/vocabulary'
import type { CrosstuneDb } from '../../db/schema'
import type { RecordingFile } from '../../db/recordings'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlayer } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { entitlementRow, linkRow, recordingFile, recordingRow } from '../../test/rows'
import { OPEN } from '../links/linkNames'
import { readRecordingsWithFiles } from '../recordings/useRecordings'
import type { RecordingView } from '../recordings/useRecordings'
import { PlayerContext } from '../player/usePlayer'
import { PracticeOverlayContext } from '../practice/usePracticeOverlay'
import { PLAY } from '../player/transportCopy'
import { DOWNLOAD } from '../recordings/recordingNames'
import { LYRICS_SECTION } from './tuneScreenCopy'
import { TuneActionButtons } from './TuneActionButtons'
import { PRACTICE } from './tuneActionsCopy'
import type { RecordingMediaRow, TuneMediaData } from './useTuneMedia'

afterAll(async () => {
  await page.viewport(390, 844)
})

type Media = TuneMediaData & { setPasting: Mock; setFinding: Mock }

/** The parts of the media the buttons read; its rows take the shape the real hook gives them. */
function mediaFor(views: RecordingView[], only: Provider | null): Media {
  const rows: RecordingMediaRow[] = views.map((view) => ({
    view,
    pinned: false,
    actions: [],
    error: null,
  }))
  return {
    only,
    recordingRows: rows,
    setPasting: vi.fn(),
    setFinding: vi.fn(),
  } as unknown as Media
}

async function setup({
  withRecording = false,
  withBlob = true,
  fileState,
  withLink = false,
  available = true,
  only = null,
  width = 1280,
  playable = true,
  recordingState = 'ready',
  lyrics = false,
}: {
  withRecording?: boolean
  withBlob?: boolean
  fileState?: RecordingFile['local_state']
  withLink?: boolean
  available?: boolean
  only?: Provider | null
  width?: number
  /** False puts the account on the free plan, which plays no recordings. */
  playable?: boolean
  recordingState?: RecordingState
  /** True gives the row a Lyrics button, as a tune with lyrics does. */
  lyrics?: boolean
} = {}) {
  await page.viewport(width, 800)
  const db: CrosstuneDb = openTestDb()
  const { tuneId } = await createTune(db, { title: 'Reel' }, { status: 'learning' })
  if (!playable) await db.entitlements.put(entitlementRow())
  if (withRecording) {
    await db.recordings.put(recordingRow('rec1', { tune_id: tuneId, state: recordingState }))
    await db.recording_files.put(
      recordingFile('rec1', {
        ...(withBlob ? { blob: new Blob(['x'], { type: 'audio/mp4' }) } : {}),
        ...(fileState ? { local_state: fileState } : {}),
      }),
    )
  }
  if (withLink) await db.recording_links.put(linkRow('link1', tuneId, { provider: 'apple_music' }))
  const start = vi.fn()
  const launcher: RecordLauncher = { start, available }
  const player = fakePlayer()
  const open = vi.fn()
  const onLyrics = vi.fn()
  const media = mediaFor(await readRecordingsWithFiles(db, { tuneId }), only)
  const Data = dataProviders({ db })
  renderWithProviders(
    <Data>
      <PlayerContext.Provider value={player}>
        <PracticeOverlayContext.Provider
          value={{
            open,
            close: () => {},
            held: () => null,
            hold: () => {},
            holdEnd: () => {},
            subscribe: () => () => {},
          }}
        >
          <RecordLauncherContext.Provider value={launcher}>
            <div data-actions>
              <TuneActionButtons
                tuneId={tuneId}
                media={media}
                onLyrics={lyrics ? onLyrics : null}
              />
            </div>
          </RecordLauncherContext.Provider>
        </PracticeOverlayContext.Provider>
      </PlayerContext.Provider>
    </Data>,
    { density: 'pointer' },
  )
  return { start, player, open, onLyrics, media, tuneId, db }
}

const button = (name: string) => page.getByRole('button', { name, exact: true })
/** The row's buttons once the source has read, so an empty list means no row at all. */
const shown = () => {
  const box = document.querySelector('[data-actions]')!
  return [...box.querySelectorAll('button')].map((b) => b.textContent)
}
/** Resolves once the placeholder has gone and the row, or nothing, stands in its place. */
const settled = () =>
  expect.poll(() => document.querySelector('[data-actions] > [aria-hidden]')).toBeNull()
const noneDisabled = () =>
  expect(document.querySelectorAll('[data-actions] button:disabled')).toHaveLength(0)

it('a tune with nothing to play has no action button row', async () => {
  await setup()
  await settled()
  expect(document.querySelector('[data-actions]')!.childElementCount).toBe(0)
})

/** Every button ever added inside the action button row, even one removed again before a poll reads. */
function watchRowButtons(): HTMLElement[] {
  const added: HTMLElement[] = []
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const inRow = record.target instanceof Element && record.target.closest('[data-actions]')
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (inRow || node.matches('[data-actions]')) {
          added.push(...(node.matches('button') ? [node] : []), ...node.querySelectorAll('button'))
        } else {
          added.push(...node.querySelectorAll<HTMLElement>('[data-actions] button'))
        }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  onTestFinished(() => observer.disconnect())
  return added
}

it('a free plan with only recordings shows neither Play nor Practice', async () => {
  const added = watchRowButtons()
  await setup({ withRecording: true, playable: false })
  await settled()
  // Held through the plan being judged: a free row never lets a recording button through.
  await expect.poll(() => shown()).toEqual([])
  await expect.poll(() => document.querySelector('[data-actions]')!.childElementCount).toBe(0)
  expect(added).toEqual([])
})

it('a playable tune offers Play and Practice, never Add to list', async () => {
  const { player, open } = await setup({ withRecording: true })
  await expect.element(button(PLAY)).toBeVisible()
  expect(shown()).toEqual([PLAY, PRACTICE])
  noneDisabled()
  await button(PRACTICE).click()
  await expect.poll(() => open.mock.calls).toEqual([['rec1']])
  await button(PLAY).click()
  await expect
    .poll(() => vi.mocked(player.play).mock.calls[0]?.[0])
    .toEqual({ kind: 'recording', id: 'rec1' })
})

it('a tune with lyrics adds Lyrics last, which opens them', async () => {
  const { onLyrics } = await setup({ withRecording: true, lyrics: true })
  await expect.element(button(LYRICS_SECTION)).toBeVisible()
  expect(shown()).toEqual([PLAY, PRACTICE, LYRICS_SECTION])
  await button(LYRICS_SECTION).click()
  await expect.poll(() => onLyrics.mock.calls).toHaveLength(1)
})

it('a tune with only lyrics has a row of Lyrics alone', async () => {
  await setup({ lyrics: true })
  await expect.element(button(LYRICS_SECTION)).toBeVisible()
  expect(shown()).toEqual([LYRICS_SECTION])
})

it('a tune that plays only a link offers its main button, no Practice', async () => {
  await setup({ withLink: true })
  // An Apple Music link opens on its own site, so its button says Open.
  await expect.element(button(OPEN)).toBeVisible()
  expect(shown()).toEqual([OPEN])
  noneDisabled()
})

it('leaves Practice out while the only recording is still processing', async () => {
  const { db, tuneId } = await setup({
    withLink: true,
    withRecording: true,
    withBlob: false,
    recordingState: 'uploaded',
  })
  // Pinned, so the link plays while the recording is still processing.
  const userTune = await db.user_tunes.where('tune_id').equals(tuneId).first()
  await db.user_tunes.update(userTune!.id, { play_link_id: 'link1' })
  await expect.element(button(OPEN)).toBeVisible()
  expect(shown()).toEqual([OPEN])
})

it('a recording still processing alone leaves no action button row', async () => {
  await setup({ withRecording: true, withBlob: false, recordingState: 'uploaded' })
  await settled()
  expect(shown()).toEqual([])
})

it('a recording not on this device gives no button, never Download', async () => {
  await setup({ withRecording: true, withBlob: false })
  await settled()
  await expect.poll(() => shown()).toEqual([])
  expect(button(DOWNLOAD).query()).toBeNull()
})

it('a recording not on this device leaves Lyrics alone in the row', async () => {
  await setup({ withRecording: true, withBlob: false, lyrics: true })
  await expect.element(button(LYRICS_SECTION)).toBeVisible()
  expect(shown()).toEqual([LYRICS_SECTION])
})

it('leaves every recording button out while its recording downloads', async () => {
  await setup({ withRecording: true, withBlob: false, fileState: 'downloading', lyrics: true })
  await expect.element(button(LYRICS_SECTION)).toBeVisible()
  expect(shown()).toEqual([LYRICS_SECTION])
  noneDisabled()
})

it('the phone shows Play, Practice, and Lyrics in equal columns on one line each', async () => {
  await setup({ withRecording: true, lyrics: true, width: 390 })
  await expect.element(button(LYRICS_SECTION)).toBeVisible()
  expect(shown()).toEqual([PLAY, PRACTICE, LYRICS_SECTION])
  const buttons = [...document.querySelectorAll<HTMLElement>('[data-actions] button')]
  await expect
    .poll(() => new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().width))).size)
    .toBe(1)
  for (const b of buttons) expect(getComputedStyle(b).whiteSpace).toBe('nowrap')
})

it('the phone shows only the main button for a link', async () => {
  await setup({ withLink: true, width: 390 })
  await expect.element(button(OPEN)).toBeVisible()
  expect(shown()).toEqual([OPEN])
})
