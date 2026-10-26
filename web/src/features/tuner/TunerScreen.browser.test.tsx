import { act, useState, type ReactNode } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { settingsId } from '../../commands/settings'
import type { CrosstuneDb } from '../../db/schema'
import { destination } from '../../layout/destinations'
import { RECORD_LABEL, TAB_BAR } from '../../layout/tabs'
import { openTestDb } from '../../test/db'
import { fakeLocationPermissionForTest } from '../../test/fakeLocationPermission'
import { fakeMediaForTest } from '../../test/fakeMedia'
import { a4Plus, fakeTunerMic, toneThrough } from '../../test/fakeTunerMic'
import { fakePlaybackEngine, fakePlayer } from '../../test/providers'
import { seeded } from '../../test/random'
import { renderApp } from '../../test/renderApp'
import {
  linkRow,
  recordingFile,
  recordingRow,
  tuneRow,
  userSettingsRow,
  userTuneRow,
} from '../../test/rows'
import { CANCEL } from '../../ui/confirmCopy'
import { OverlayClaim } from '../../ui/overlayClaim'
import type { Player } from '../player/usePlayer'
import { LOCATION_NOTE_TITLE, NEW_RECORDING } from '../capture/recordCopy'
import { PLAYER_REGION } from '../player/playerCopy'
import { PLAY } from '../player/transportCopy'
import { TUNE } from '../tune/tunePageCopy'
import { PALETTE } from '../../theme/tokens'
import { LISTENING, referenceLabel, SHARP, TAP_TO_LISTEN, TUNER_TITLE } from './tunerCopy'
import { TunerMicContext } from './useTuner'

const TUNER = destination('tuner')
const TAKE = 'Fast take'

async function seedA4(db: CrosstuneDb, hz: number) {
  await db.user_settings.put(userSettingsRow(settingsId('user_1'), { tuner_a4_hz: hz }))
}

async function seedTake(db: CrosstuneDb) {
  await db.tunes.put(tuneRow('t1', 'Old Joe Clark'))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
  await db.recordings.put(
    recordingRow('r1', { tune_id: 't1', label: TAKE, duration_ms: 3000, source_duration_ms: 3000 }),
  )
  await db.recording_files.put(
    recordingFile('r1', { blob: new Blob(['x'], { type: 'audio/mp4' }), local_duration_ms: 3000 }),
  )
}

async function mount({
  path = TUNER.root,
  seed,
  beside,
  contextState,
  player,
  frame,
}: {
  player?: Player
  frame?: { width: number; height: number }
  path?: string
  seed?: (db: CrosstuneDb) => Promise<unknown>
  /** Rendered beside the app, such as an overlay's claim. */
  beside?: ReactNode
  contextState?: 'suspended'
} = {}) {
  const fake = fakeTunerMic({ contextState })
  const db = openTestDb()
  await seed?.(db)
  const engine = fakePlaybackEngine()
  await renderApp({
    path,
    db,
    density: 'touch',
    frame,
    playbackEngine: engine,
    player,
    wrap: (app) => (
      <TunerMicContext.Provider value={fake.deps}>
        {app}
        {beside}
      </TunerMicContext.Provider>
    ),
  })
  return { fake, engine, db }
}

const tuner = () => page.getByRole('main', { name: TUNER_TITLE, exact: true })
const stage = () => document.querySelector<HTMLElement>('[data-tuner-stage]')
const readout = () => page.elementLocator(stage()!).getByRole('status')
const player = () => page.getByRole('region', { name: PLAYER_REGION })

it('pauses playback on entry and leaves the queue', async () => {
  const { engine } = await mount({ path: '/catalog/t1', seed: seedTake })
  await page
    .getByRole('main', { name: TUNE })
    .getByRole('row', { name: new RegExp(`^${PLAY} ${TAKE}`) })
    .click()
  await expect.poll(() => engine.getState().playing).toBe(true)

  await page
    .getByRole('navigation', { name: TAB_BAR })
    .getByRole('link', { name: TUNER.label, exact: true })
    .click()

  await expect.element(tuner()).toBeVisible()
  await expect.poll(() => engine.getState().playing).toBe(false)
  await expect.element(player()).toBeVisible()
})

it('closes a link playing in its embed on entry', async () => {
  const embed = fakePlayer({ item: { kind: 'link', id: 'l1' } })
  // A link the dock can embed, so only the tuner closes it.
  await mount({
    player: embed,
    seed: (db) =>
      db.recording_links.put(
        linkRow('l1', 't1', {
          provider: 'youtube',
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          provider_ref: 'dQw4w9WgXcQ',
        }),
      ),
  })
  await expect.poll(() => vi.mocked(embed.close).mock.calls.length).toBe(1)
})

it('keeps a loaded recording on entry', async () => {
  const recording = fakePlayer({ item: { kind: 'recording', id: 'r1' } })
  // A recording the dock can play, so nothing closes it. The dock showing it means its read
  // has settled, after the tuner's entry.
  await mount({ player: recording, seed: seedTake })
  await expect.element(tuner()).toBeVisible()
  await expect.element(player().getByText(TAKE)).toBeVisible()
  expect(recording.close).not.toHaveBeenCalled()
})

it('stops listening while a play runs and listens again once it pauses', async () => {
  const { fake, engine } = await mount({ path: '/catalog/t1', seed: seedTake })
  await page
    .getByRole('main', { name: TUNE })
    .getByRole('row', { name: new RegExp(`^${PLAY} ${TAKE}`) })
    .click()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await page
    .getByRole('navigation', { name: TAB_BAR })
    .getByRole('link', { name: TUNER.label, exact: true })
    .click()
  await expect.poll(() => fake.openTracks()).toBe(1)

  engine.play()
  await expect.poll(() => engine.getState().playing).toBe(true)
  await expect.poll(() => fake.openTracks()).toBe(0)

  engine.pause()
  await expect.poll(() => fake.openTracks()).toBe(1)
  expect(fake.mostOpen()).toBe(1)
})

it('stops listening while a sheet is open and resumes after', async () => {
  fakeMediaForTest()
  fakeLocationPermissionForTest('prompt')
  const { fake } = await mount()
  await expect.poll(() => fake.openTracks()).toBe(1)

  await page.getByRole('button', { name: RECORD_LABEL }).click()
  const sheet = page.getByRole('dialog', { name: NEW_RECORDING })
  await expect.element(sheet.getByRole('heading', { name: LOCATION_NOTE_TITLE })).toBeVisible()
  await expect.poll(() => fake.openTracks()).toBe(0)

  await sheet.getByRole('button', { name: CANCEL }).click()
  await expect.element(sheet).not.toBeInTheDocument()
  await expect.poll(() => fake.openTracks()).toBe(1)
  expect(fake.mostOpen()).toBe(1)
})

it('shows no listening prompt behind a sheet', async () => {
  fakeMediaForTest()
  fakeLocationPermissionForTest('prompt')
  await mount()
  await expect.element(tuner().getByText(LISTENING)).toBeVisible()

  await page.getByRole('button', { name: RECORD_LABEL }).click()
  const sheet = page.getByRole('dialog', { name: NEW_RECORDING })
  await expect.element(sheet.getByRole('heading', { name: LOCATION_NOTE_TITLE })).toBeVisible()

  await expect.element(tuner().getByText(LISTENING)).not.toBeInTheDocument()
  await expect.element(tuner().getByText(TAP_TO_LISTEN)).not.toBeInTheDocument()
})

it('shows no tap prompt behind a sheet', async () => {
  // Covered without a tap, which would let the held-back audio run.
  let cover: (on: boolean) => void = () => {}
  function Cover() {
    const [on, setOn] = useState(false)
    cover = setOn
    return on ? <OverlayClaim coversShell close={() => setOn(false)} /> : null
  }
  await mount({ contextState: 'suspended', beside: <Cover /> })
  await expect.element(tuner().getByText(TAP_TO_LISTEN)).toBeVisible()

  act(() => cover(true))

  await expect.element(tuner().getByText(TAP_TO_LISTEN)).not.toBeInTheDocument()
  act(() => cover(false))
  await expect.element(tuner().getByText(TAP_TO_LISTEN)).toBeVisible()
})

it('announces the note again after a sheet closes', async () => {
  fakeMediaForTest()
  fakeLocationPermissionForTest('prompt')
  const { fake } = await mount()
  await expect.poll(() => stage()?.dataset.status).toBe('listening')
  fake.play(toneThrough([[a4Plus(0), 0.3]]))
  await expect.element(readout()).toHaveTextContent('A4, in tune')

  await page.getByRole('button', { name: RECORD_LABEL }).click()
  const sheet = page.getByRole('dialog', { name: NEW_RECORDING })
  await expect.element(sheet.getByRole('heading', { name: LOCATION_NOTE_TITLE })).toBeVisible()
  await expect.poll(() => fake.openTracks()).toBe(0)
  await sheet.getByRole('button', { name: CANCEL }).click()
  await expect.element(sheet).not.toBeInTheDocument()
  await expect.poll(() => fake.openTracks()).toBe(1)
  await expect.poll(() => readout().query()?.textContent).toBe('')
  // The held note went with the session; the new one starts with the prompt.
  await expect.element(tuner().getByText(LISTENING)).toBeVisible()
  expect(document.querySelector('[data-tuner-bar]')).toBeNull()

  fake.play(toneThrough([[a4Plus(0), 0.3]]))
  await expect.element(readout()).toHaveTextContent('A4, in tune')
})

it('shows the reference label only off 440', async () => {
  const { db } = await mount({ seed: (db) => seedA4(db, 442) })
  const label = tuner().getByText(referenceLabel(442)!)
  await expect.element(label).toBeVisible()

  await seedA4(db, 440)

  await expect.element(label).not.toBeInTheDocument()
})

it('keeps listening behind a popover or menu', async () => {
  const { fake } = await mount({ beside: <OverlayClaim close={() => {}} /> })
  await expect.poll(() => fake.openTracks()).toBe(1)
  await expect.poll(() => stage()?.dataset.status).toBe('listening')
})

it('asks for a tap when the browser holds the audio back, and listens after it', async () => {
  const { fake } = await mount({ contextState: 'suspended' })
  const prompt = tuner().getByText(TAP_TO_LISTEN)
  await expect.element(prompt).toBeVisible()

  await userEvent.click(prompt)

  await expect.poll(() => stage()?.dataset.status).toBe('listening')
  await expect.element(prompt).not.toBeInTheDocument()
  fake.play(toneThrough([[a4Plus(0), 0.5]]))
  await expect.poll(() => stage()?.dataset.inTuneFraction).toBe('1')
})

const bar = () => document.querySelector<HTMLElement>('[data-tuner-bar]')
const track = () => document.querySelector<HTMLElement>('[data-tuner-track]')
const backgroundOf = (element: Element | null) =>
  element ? getComputedStyle(element).backgroundColor : null
const rgbOf = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(', ')})`

it('turns the bars and the wash green as the note nears in tune', async () => {
  const { fake } = await mount()
  await expect.poll(() => stage()?.dataset.status).toBe('listening')
  const jet = getComputedStyle(tuner().element()).backgroundColor

  fake.play(toneThrough([[a4Plus(30), 0.6]]))
  await expect.poll(() => stage()?.dataset.inTuneFraction).toBe('0')
  await expect.poll(() => backgroundOf(bar())).toBe(rgbOf(PALETTE.light.coral))
  await expect.poll(() => getComputedStyle(tuner().element()).backgroundColor).toBe(jet)

  // Just outside the zone: the close step, and still no wash.
  fake.play(toneThrough([[a4Plus(12.5), 0.6]]))
  await expect.poll(() => backgroundOf(bar())).toBe(rgbOf(PALETTE.light.tuneClose))
  expect(stage()?.dataset.inTuneFraction).toBe('0')
  await expect.poll(() => getComputedStyle(tuner().element()).backgroundColor).toBe(jet)

  fake.play(toneThrough([[a4Plus(0), 0.6]]))
  await expect.poll(() => stage()?.dataset.inTuneFraction).toBe('1')
  await expect.poll(() => backgroundOf(bar())).toBe(rgbOf(PALETTE.dark.known))
  await expect.poll(() => getComputedStyle(tuner().element()).backgroundColor).not.toBe(jet)
  const wash = getComputedStyle(tuner().element()).backgroundColor

  // Halfway into the zone: partly green, and a lighter wash than in tune.
  fake.play(toneThrough([[a4Plus(6.5), 0.6]]))
  await expect
    .poll(() => Number(stage()?.dataset.inTuneFraction))
    .toSatisfy((green: number) => green > 0.2 && green < 0.8)
  await expect
    .poll(() => backgroundOf(bar()))
    .toSatisfy(
      (color: string | null) =>
        color !== rgbOf(PALETTE.light.tuneClose) && color !== rgbOf(PALETTE.dark.known),
    )
  await expect
    .poll(() => getComputedStyle(tuner().element()).backgroundColor)
    .toSatisfy((color: string) => color !== jet && color !== wash)
})

it('puts the slab on the zone edge at ten cents, no wider than its cap', async () => {
  // Wide enough that a fifth of the stage passes the cap.
  const { fake } = await mount({ frame: { width: 1600, height: 900 } })
  await expect.poll(() => stage()?.dataset.status).toBe('listening')
  fake.play(toneThrough([[a4Plus(10), 0.6]]))
  await expect.element(tuner().getByText(SHARP)).toBeVisible()
  const zone = () => document.querySelector<HTMLElement>('[data-tuner-zone]')!
  const center = () => {
    const box = bar()!.getBoundingClientRect()
    return box.top + box.height / 2
  }

  await expect
    .poll(() => Math.abs(center() - zone().getBoundingClientRect().top))
    .toBeLessThanOrEqual(1)
  expect(stage()!.getBoundingClientRect().width / 5).toBeGreaterThan(160)
  // 10rem at the default root size.
  expect(bar()!.getBoundingClientRect().width).toBeLessThanOrEqual(160)
  expect(zone().getBoundingClientRect().width).toBe(bar()!.getBoundingClientRect().width)
})

it('announces only note and in-tune changes', async () => {
  const { fake } = await mount()
  await expect.poll(() => stage()?.dataset.status).toBe('listening')
  const status = readout().element()
  const random = seeded(7)
  const segments = Array.from({ length: 10 }, (): [number, number] => [
    a4Plus(2 * random() - 1),
    0.1,
  ])
  const texts = [status.textContent]

  fake.play(toneThrough(segments), () => texts.push(status.textContent))

  await expect.element(readout()).toHaveTextContent('A4, in tune')
  const changes = texts.filter((text, i) => i > 0 && text !== texts[i - 1])
  expect(changes).toEqual(['A4, in tune'])
})

it('holds the last note where it is once the sound stops', async () => {
  const { fake } = await mount()
  await expect.poll(() => stage()?.dataset.status).toBe('listening')
  await expect.element(tuner().getByText(LISTENING)).toBeVisible()
  fake.play(toneThrough([[a4Plus(30), 0.5]]))
  await expect.poll(() => stage()?.dataset.inTuneFraction).toBe('0')
  await expect.element(tuner().getByText(LISTENING)).not.toBeInTheDocument()
  await expect.element(tuner().getByText(SHARP)).toBeVisible()

  const seen = new Set<string | undefined>()
  fake.play(new Float32Array(48_000 * 0.5), () => {
    if (stage()?.dataset.heard === 'false') seen.add(track()?.style.translate)
  })

  // One place through the silence, well above the middle, where the last reading put it.
  const held = track()!.style.translate
  expect([...seen]).toEqual([held])
  expect(Number.parseFloat(held.split(' ')[1]!)).toBeLessThan(-20)
  await expect.element(tuner().getByText(SHARP)).toBeVisible()
  expect(getComputedStyle(bar()!).opacity).toBe('1')
  expect(stage()?.dataset.inTuneFraction).toBe('0')
  expect(tuner().getByText(LISTENING).query()).toBeNull()
})

it('holds a new note back until a second of input has passed', async () => {
  const { fake } = await mount()
  await expect.poll(() => stage()?.dataset.status).toBe('listening')
  fake.play(toneThrough([[a4Plus(0), 0.3]]))
  await expect.element(readout()).toHaveTextContent('A4, in tune')

  const texts: (string | null)[] = []
  const status = readout().element()
  // A sharp 4 starts well within a second of input of A4's announcement.
  fake.play(toneThrough([[a4Plus(100), 0.5]]), () => texts.push(status.textContent))
  expect(new Set(texts)).toEqual(new Set(['A4, in tune']))

  fake.play(toneThrough([[a4Plus(100), 0.6]]))
  await expect.element(readout()).toHaveTextContent('A♯4, in tune')
})
