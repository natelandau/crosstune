import { render } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import {
  dataProviders,
  FakeAudioElement,
  fakePlaybackEngine,
  fakePlayer,
  playbackSettings,
} from '../../test/providers'
import { recordingFile, recordingRow } from '../../test/rows'
import { AppMotion } from '../../theme/motion'
import { ConfirmProvider } from '../../ui/Confirm'
import { ToastProvider } from '../../ui/Toast'
import { PlaybackEngineContext } from '../player/PlaybackEngineProvider'
import { PLAY, REPEAT_LOOP, SPEED_BADGE } from '../player/transportCopy'
import { useShowsRecordingPage } from '../player/pagePlayback'
import { RECORDING_SCREEN_ORIGIN } from '../player/playLog'
import { ListPlaybackProvider } from '../player/ListPlaybackProvider'
import { PlayerProvider } from '../player/PlayerProvider'
import { useDockItem, type DockShown } from '../player/useDockItem'
import { useRecordingTransport } from '../player/useRecordingTransport'
import { seedLoop } from '../../test/recordings'
import { PlayerContext, startOf, usePlayer, type Player } from '../player/usePlayer'
import { OFFLINE } from '../../sync/labels'
import type { PracticeBlock } from './practiceAvailability'
import { MODES_LABEL, WAVEFORM_LABEL } from './practiceCopy'
import { ARROW_LARGE_STEP_MS } from './PracticeWaveform'
import { PracticeView, type SavedFocus } from './PracticeView'
import { SPEED } from './SpeedPanel'
import { useRecordingEngine } from './useRecordingEngine'
import { useRecordingPageView } from '../recording/useRecordingPageView'
import type { PlayerItem } from '../../domain/playerItem'

const WIDE = { width: 1280, height: 800 }
const PHONE = { width: 390, height: 844 }
const PLAYING_LENGTH_MS = 120_000
const PRACTICED_LENGTH_MS = 60_000
const SHOWN = {
  peaks: {
    pointsPerSecond: 50,
    values: Uint8Array.from({ length: 3000 }, (_, i) => (i * 97) % 251),
  },
  loudest: 250,
}

/** Recordings A and B, which this device holds. B's length is null when nothing measured it. */
async function seed(db: CrosstuneDb, practicedLengthMs: number | null) {
  for (const [id, label, lengthMs] of [
    ['A', 'Playing', PLAYING_LENGTH_MS],
    ['B', 'Practiced', practicedLengthMs],
  ] as const) {
    await db.recordings.put(
      recordingRow(id, { label, duration_ms: lengthMs, source_duration_ms: lengthMs }),
    )
    await db.recording_files.put(
      recordingFile(id, {
        blob: new Blob(['x'], { type: 'audio/mp4' }),
        local_duration_ms: lengthMs,
      }),
    )
  }
}

function Practice({ id, blocked }: { id: string; blocked?: PracticeBlock }) {
  // Stands in for the recording's page, which owns what its Play loads.
  useShowsRecordingPage(id)
  const state = useRecordingPageView(id)
  const { engine, loaded } = useRecordingEngine(state.view)
  const escapeRef = useRef<(() => boolean) | null>(null)
  const [savedFocus] = useState<SavedFocus>(() => ({ peek: () => null, keep: () => {} }))
  if (!state.view) return null
  return (
    <PracticeView
      view={state.view}
      engine={engine}
      loaded={loaded}
      blocked={blocked}
      shown={SHOWN}
      escapeRef={escapeRef}
      savedFocus={savedFocus}
      isTop={() => true}
      onError={() => {}}
    />
  )
}

/** The player's bar, reduced to the transport that loads what the player plays. */
function Dock() {
  const { shown, title } = useDockItem()
  if (shown?.kind !== 'recording') return null
  return <DockTransport key={shown.recording.id} shown={shown} title={title} />
}

function DockTransport({
  shown,
  title,
}: {
  shown: Extract<DockShown, { kind: 'recording' }>
  title: string
}) {
  const start = startOf(usePlayer(), { kind: 'recording', id: shown.recording.id })
  useRecordingTransport({
    recording: shown.recording,
    file: shown.file,
    title,
    held: () => null,
    start,
  })
  return null
}

/** Keeps what the real player has loaded where the test can read it. */
function PlayerProbe({ onItem }: { onItem: (item: PlayerItem | null) => void }) {
  const { item } = usePlayer()
  useEffect(() => {
    onItem(item)
  }, [onItem, item])
  return null
}

interface MountOptions {
  /** Why the page says B cannot play, as it passes practice. */
  blocked?: PracticeBlock
  /** B's loops, put before practice reads them. */
  seedLoops?: (db: CrosstuneDb) => Promise<unknown>
  practicedLengthMs?: number | null
  /** The app's player and its bar, with nothing loaded, in place of a fake playing A. */
  realPlayer?: boolean
  /** Leaves the real player's bar out, so nothing ever loads what it plays into the engine. */
  noDock?: boolean
  /** The audio element refuses every play, as a file the browser cannot decode does. */
  playFails?: boolean
}

/** Practice for B while a fake player plays A, or beside the real player with nothing loaded. */
async function mount({
  blocked,
  seedLoops,
  practicedLengthMs = PRACTICED_LENGTH_MS,
  realPlayer = false,
  noDock = false,
  playFails = false,
}: MountOptions = {}) {
  await page.viewport(WIDE.width, WIDE.height)
  onTestFinished(() => page.viewport(PHONE.width, PHONE.height))
  const db = openTestDb()
  await seed(db, practicedLengthMs)
  await seedLoops?.(db)
  const element = new FakeAudioElement()
  if (playFails) element.play = () => Promise.reject(new Error('The file cannot be decoded.'))
  const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
  const seen: { item: PlayerItem | null } = { item: null }
  onTestFinished(() => engine.unload())
  const player: Player = fakePlayer({ item: { kind: 'recording', id: 'A' } })
  if (!realPlayer) {
    engine.load(
      'blob:playing',
      { fromS: 0, toS: PLAYING_LENGTH_MS / 1000, lengthMs: PLAYING_LENGTH_MS },
      playbackSettings,
      { title: 'Playing' },
    )
    engine.play()
    engine.seek(10_000)
  }
  const practice = (
    <div data-practice className="flex h-[700px] flex-col">
      <Practice id="B" blocked={blocked} />
    </div>
  )
  const view = render(
    <AppMotion>
      <ConfirmProvider>
        <ToastProvider>
          <PlaybackEngineContext.Provider value={engine}>
            {realPlayer ? (
              <PlayerProvider>
                {/* Practice of the loaded recording holds the list's controls. */}
                <ListPlaybackProvider>
                  {practice}
                  {!noDock && <Dock />}
                  <PlayerProbe
                    onItem={(item) => {
                      seen.item = item
                    }}
                  />
                </ListPlaybackProvider>
              </PlayerProvider>
            ) : (
              <PlayerContext.Provider value={player}>{practice}</PlayerContext.Provider>
            )}
          </PlaybackEngineContext.Provider>
        </ToastProvider>
      </ConfirmProvider>
    </AppMotion>,
    { wrapper: dataProviders({ db }) },
  )
  const waveform = page.getByRole('slider', { name: WAVEFORM_LABEL })
  const play = page.getByRole('button', { name: PLAY, exact: true })
  await expect.element(play).toBeVisible()
  return { db, engine, element, player, waveform, play, view, seen }
}

const mode = (name: string) =>
  page.getByRole('tablist', { name: MODES_LABEL }).getByRole('tab', {
    name: new RegExp(`^${name}`),
  })

it("shows an unloaded recording's waveform without changing playback", async () => {
  const { engine, player, waveform } = await mount()
  await expect.element(waveform).toBeVisible()
  await expect.element(waveform).toHaveAttribute('aria-valuemax', String(PRACTICED_LENGTH_MS))
  await expect.element(waveform).toHaveAttribute('aria-valuenow', '0')
  await expect.poll(() => player.item?.id).toBe('A')
  await expect.poll(() => engine.getState().lengthMs).toBe(PLAYING_LENGTH_MS)
  await expect.poll(() => engine.getState().positionMs).toBe(10_000)
  await expect.poll(() => player.play).not.toHaveBeenCalled()
})

it('sets speed on an unloaded recording without touching the engine', async () => {
  const { db, engine, element, view } = await mount()
  await mode(SPEED).click()
  const preset = page.getByRole('radio', { name: SPEED_BADGE(75), exact: true })
  await preset.click()
  await expect.element(preset).toHaveAttribute('aria-checked', 'true')
  // Leaving writes the speed still settling at once.
  view.unmount()
  await expect.poll(async () => (await db.recordings.get('B'))?.speed_percent).toBe(75)
  await expect.poll(() => engine.getState().speedPercent).toBe(100)
  await expect.poll(() => element.playbackRate).toBe(1)
})

it('play loads the recording at the playhead', async () => {
  const { engine, player, waveform, play } = await mount()
  await expect.element(waveform).toBeVisible()
  ;(waveform.element() as HTMLElement).focus()
  for (let i = 0; i < 6; i++) await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
  await expect.element(waveform).toHaveAttribute('aria-valuenow', String(6 * ARROW_LARGE_STEP_MS))
  await play.click()
  await expect
    .poll(() => vi.mocked(player.play).mock.calls)
    .toEqual([
      [
        { kind: 'recording', id: 'B' },
        { at: 30_000, loop: null, origin: RECORDING_SCREEN_ORIGIN, fromPage: true },
      ],
    ])
  await expect.poll(() => engine.getState().positionMs).toBe(10_000)
})

it('shows the reason when the recording cannot play', async () => {
  const { player, play } = await mount({ blocked: OFFLINE })
  await expect.element(page.getByText(OFFLINE, { exact: true })).toBeVisible()
  await expect.element(play).toHaveAttribute('aria-disabled', 'true')
  await play.click({ force: true })
  await expect.poll(() => player.play).not.toHaveBeenCalled()
})

it('keeps the loop chosen before Play repeating once Play loads the recording', async () => {
  let loopId = ''
  const { engine } = await mount({
    realPlayer: true,
    seedLoops: async (db) => {
      loopId = await seedLoop(db, 'B', 5000, 8000, { label: 'A part' })
    },
  })
  await expect.poll(() => engine.getState().lengthMs).toBe(0)
  const repeat = page.getByRole('button', { name: REPEAT_LOOP('A part'), exact: true })
  // Shows once the loop's row is read, which key 1 needs.
  await expect.element(page.getByText('A part', { exact: true }).first()).toBeInTheDocument()
  await userEvent.keyboard('1')
  await expect.element(repeat).toBeVisible()
  // Not loaded yet: choosing the loop leaves the engine alone.
  await expect.poll(() => engine.getState().loop).toBeNull()
  await repeat.click()
  await expect.poll(() => engine.getState().lengthMs).toBe(PRACTICED_LENGTH_MS)
  await expect
    .poll(() => engine.loopRange)
    .toEqual({ id: loopId, label: 'A part', fromS: 5, toS: 8 })
  await expect.poll(() => engine.getState().repeat).toBe(true)
  await expect.poll(() => engine.getState().positionMs).toBe(5000)
  await expect.poll(() => engine.getState().playing).toBe(true)
})

it('plays a recording of no known length from its start', async () => {
  const { player, play } = await mount({ practicedLengthMs: null })
  await expect.element(play).not.toHaveAttribute('aria-disabled', 'true')
  await play.click()
  await expect
    .poll(() => vi.mocked(player.play).mock.calls)
    .toEqual([
      [
        { kind: 'recording', id: 'B' },
        { at: 0, loop: null, origin: RECORDING_SCREEN_ORIGIN, fromPage: true },
      ],
    ])
})

it("keeps the recording's own timeline while Play waits for the player to load it", async () => {
  const { waveform, play, seen } = await mount({ realPlayer: true, noDock: true })
  await expect.element(waveform).toBeVisible()
  ;(waveform.element() as HTMLElement).focus()
  await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
  await expect.element(waveform).toHaveAttribute('aria-valuenow', String(ARROW_LARGE_STEP_MS))
  await play.click()
  await expect.poll(() => seen.item).toEqual({ kind: 'recording', id: 'B' })
  await expect.element(waveform).toHaveAttribute('aria-valuemax', String(PRACTICED_LENGTH_MS))
  await expect.element(waveform).toHaveAttribute('aria-valuenow', String(ARROW_LARGE_STEP_MS))
})

it('shows the player failing to play a recording of no known length', async () => {
  const { engine, play } = await mount({
    realPlayer: true,
    practicedLengthMs: null,
    playFails: true,
  })
  await play.click()
  await expect.poll(() => engine.getState().failed).toBe(true)
  // Practice drives the player's engine now, whose failed load leaves nothing to play.
  await expect.element(play).toHaveAttribute('aria-disabled', 'true')
})
