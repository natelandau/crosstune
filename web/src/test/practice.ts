import type { ReactElement } from 'react'
import { expect } from 'vitest'
import { page } from 'vitest/browser'
import type { CrosstuneDb } from '../db/schema'
import type { LocalRecording } from '../db/types'
import { PLAYER_REGION } from '../features/player/playerCopy'
import { OPEN_RECORDING } from '../features/player/transportCopy'
import { openTestDb } from './db'
import { fakePlaybackEngine } from './providers'
import { recordingFile, recordingRow, tuneRow, userTuneRow } from './rows'
import { destination } from '../app/destinations'
import { TUNE } from '../features/tune/tunePageCopy'
import type { Density } from '../platform/density'
import type { AndroidBackForTest } from './androidBack'
import { renderApp } from './renderApp'

const RECORDINGS = destination('recordings')

export const PHONE = { width: 390, height: 844 }
export const WIDE = { width: 1280, height: 800 }
export const TAKE = 'Fast take'

export interface PracticeSeed {
  /** The server has the take too. */
  ready?: boolean
  /** Filed under the tune; unfiled plays from Recordings. */
  filed?: boolean
  /** More of the take's row, such as its speed. */
  take?: Partial<LocalRecording>
  playbackEngine?: ReturnType<typeof fakePlaybackEngine>
  android?: AndroidBackForTest
  density?: Density
  /** Wraps the app, such as with an element a test needs beside it. */
  wrap?: (app: ReactElement) => ReactElement
}

/** A tune with a minute-long take this device holds. */
async function seed(db: CrosstuneDb, { ready = false, filed = true, take = {} }: PracticeSeed) {
  await db.tunes.put(tuneRow('t1', 'Old Joe Clark'))
  await db.user_tunes.put(userTuneRow('u-t1', 't1'))
  const row: Partial<LocalRecording> = {
    tune_id: filed ? 't1' : null,
    label: TAKE,
    duration_ms: 60_000,
    source_duration_ms: 60_000,
    ...take,
  }
  await db.recordings.put(recordingRow('r1', ready ? { ...row, state: 'ready' } : row))
  await db.recording_files.put(
    recordingFile('r1', {
      blob: new Blob(['x'], { type: 'audio/mp4' }),
      local_duration_ms: 60_000,
    }),
  )
}

/** The app at `frame`, playing the seeded take from its row. */
export async function mountPlaying(
  frame: { width: number; height: number },
  options: PracticeSeed = {},
) {
  const db = openTestDb()
  await seed(db, options)
  const engine = options.playbackEngine ?? fakePlaybackEngine()
  const filed = options.filed ?? true
  const path = filed ? '/catalog/t1' : RECORDINGS.root
  const { router } = await renderApp({
    path,
    db,
    frame,
    playbackEngine: engine,
    android: options.android,
    density: options.density,
    wrap: options.wrap,
  })
  const rows = filed ? page.getByRole('main', { name: TUNE }) : page
  await rows
    .getByRole('row', { name: new RegExp(TAKE) })
    .first()
    .click()
  await expect.element(player()).toBeVisible()
  return { db, engine, router }
}

export const player = () => page.getByRole('region', { name: PLAYER_REGION })
export const openButton = () => player().getByRole('button', { name: OPEN_RECORDING(TAKE) })
export const practice = () => document.querySelector<HTMLElement>('[data-practice]')
export const waveform = () => practice()?.querySelector<HTMLElement>('[data-practice-waveform]')

/** A key pressed with focus on nothing in particular. */
export function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  document.body.dispatchEvent(event)
  return event
}

/** Opens practice from the bar, once its waveform has a scale. */
export async function openPractice() {
  await openButton().click()
  await expect.poll(() => waveform()?.dataset.pxPerS).toBeTruthy()
}
