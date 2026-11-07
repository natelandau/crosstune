import { act, useState, type ReactNode } from 'react'
import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { destination } from '../../layout/destinations'
import { openTestDb } from '../../test/db'
import { FakeAudioElement, fakePlaybackEngine } from '../../test/providers'
import { entitlementRow, recordingFile, recordingRow } from '../../test/rows'
import { renderApp } from '../../test/renderApp'
import { FixedNow } from '../../ui/useNow'
import { playName } from '../recordings/recordingNames'
import { PLAYER_REGION } from './playerCopy'
import { PAUSE } from './transportCopy'

const WIDE = { width: 1280, height: 800 }
const BEFORE_END = Date.parse('2026-10-10T12:00:00.000Z')
const TRIAL_END = '2026-10-10T12:00:10.000Z'

it('stops a playing recording and hands focus back to its play control when the trial ends', async () => {
  const db = openTestDb()
  await db.entitlements.put(
    entitlementRow({
      premium_source: 'trial',
      premium_expires_at: TRIAL_END,
      trial_ends_at: TRIAL_END,
      // Seen notices keep the trial's own sheets out of the way.
      recording_notice_seen_at: TRIAL_END,
      trial_reminder_seen_at: TRIAL_END,
      trial_end_seen_at: TRIAL_END,
    }),
  )
  await db.recordings.put(recordingRow('r1', { label: 'Jam take', duration_ms: 3000 }))
  await db.recording_files.put(
    recordingFile('r1', {
      blob: new Blob(['x'], { type: 'audio/mp4' }),
      local_duration_ms: 3000,
    }),
  )
  const element = new FakeAudioElement()
  const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement)
  let setNow: (now: number) => void = () => {}
  function Clock({ children }: { children: ReactNode }) {
    const [now, set] = useState(BEFORE_END)
    setNow = set
    return <FixedNow.Provider value={now}>{children}</FixedNow.Provider>
  }
  await renderApp({
    path: destination('recordings').root,
    db,
    frame: WIDE,
    playbackEngine: engine,
    wrap: (app) => <Clock>{app}</Clock>,
  })

  const control = page.getByRole('button', { name: playName('Jam take'), exact: true })
  await expect.element(control).toBeVisible()
  // Held, since playing renames the control.
  const controlElement = control.element()
  await control.click()
  const player = page.getByRole('region', { name: PLAYER_REGION })
  const pause = player.getByRole('button', { name: PAUSE, exact: true })
  await expect.element(pause).toBeVisible()
  await expect.poll(() => engine.getState().playing).toBe(true)
  pause.element().focus()
  await expect.poll(() => document.activeElement).toBe(pause.element())

  act(() => setNow(Date.parse(TRIAL_END) + 1000))
  await expect.element(player).not.toBeInTheDocument()
  await expect.poll(() => engine.getState().playing).toBe(false)
  await expect.poll(() => element.src).toBe('')
  await expect.poll(() => document.activeElement).toBe(controlElement)
  await expect
    .element(page.getByRole('button', { name: playName('Jam take'), exact: true }))
    .toHaveFocus()
})
