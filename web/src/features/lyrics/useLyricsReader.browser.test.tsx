import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { recordingAnalytics } from '../../analytics/testing'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { useWakeLock } from '../../platform/wakeLock'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { DEFAULT_LYRICS_STEP, LYRICS_STEPS, setLyricsStep } from './lyricsSize'
import { useLyricsReader } from './useLyricsReader'

vi.mock('../../platform/wakeLock', () => ({ useWakeLock: vi.fn() }))

const WORDS = 'Did you ever go to meeting\nUncle Joe\n\nDon’t mind the weather'

let db: CrosstuneDb
let tuneId: string

beforeEach(async () => {
  // The store caches the step in module scope, which clearing storage does not reset.
  setLyricsStep(DEFAULT_LYRICS_STEP)
  localStorage.clear()
  vi.mocked(useWakeLock).mockClear()
  db = openTestDb()
  ;({ tuneId } = await createTune(db, { title: 'Uncle Joe', lyrics: WORDS }, { status: 'known' }))
})

function setup(open = true) {
  return renderHook(
    (props: { open: boolean }) => useLyricsReader({ open: props.open, tuneId, lyrics: WORDS }),
    { wrapper: dataProviders({ db }), initialProps: { open } },
  )
}

it('reads the words as verses of lines', async () => {
  const { result } = setup()
  await expect
    .poll(() => result.current.verses)
    .toEqual([['Did you ever go to meeting', 'Uncle Joe'], ['Don’t mind the weather']])
})

it('steps the size up to the largest and stops there, saying each step', async () => {
  const { result } = setup()
  await expect.poll(() => result.current.step).toBe(DEFAULT_LYRICS_STEP)
  await expect.poll(() => result.current.announced).toBe('')
  act(() => result.current.larger())
  await expect.poll(() => result.current.step).toBe(DEFAULT_LYRICS_STEP + 1)
  await expect
    .poll(() => result.current.announced)
    .toBe(`Text size ${DEFAULT_LYRICS_STEP + 1} of ${LYRICS_STEPS}`)
  act(() => result.current.larger())
  await expect.poll(() => result.current.atLargest).toBe(true)
  act(() => result.current.larger())
  await expect.poll(() => result.current.step).toBe(LYRICS_STEPS)
})

it('steps the size down to the smallest and stops there', async () => {
  setLyricsStep(2)
  const { result } = setup()
  act(() => result.current.smaller())
  await expect.poll(() => result.current.atSmallest).toBe(true)
  act(() => result.current.smaller())
  await expect.poll(() => result.current.step).toBe(1)
})

it('opens silent and on the words, whatever the last reading left', async () => {
  const { result, rerender } = setup()
  act(() => result.current.smaller())
  act(() => result.current.setEditing(true))
  await expect.poll(() => result.current.announced).not.toBe('')
  await expect.poll(() => result.current.editing).toBe(true)
  rerender({ open: false })
  rerender({ open: true })
  await expect.poll(() => result.current.announced).toBe('')
  await expect.poll(() => result.current.editing).toBe(false)
})

it('writes edited words, trimmed, and leaves the editor once they land', async () => {
  const { result } = setup()
  act(() => result.current.setEditing(true))
  act(() => result.current.save('  Uncle Joe, Uncle Joe  \n'))
  await expect.poll(() => result.current.editing).toBe(false)
  await expect.poll(async () => (await db.tunes.get(tuneId))?.lyrics).toBe('Uncle Joe, Uncle Joe')
  await expect.poll(() => result.current.error).toBeNull()
})

it('clears the words when the editor is emptied', async () => {
  const { result } = setup()
  act(() => result.current.setEditing(true))
  act(() => result.current.save('   '))
  await expect.poll(() => result.current.editing).toBe(false)
  await expect.poll(async () => (await db.tunes.get(tuneId))?.lyrics).toBeNull()
})

it('keeps the screen awake only while open', async () => {
  const { rerender } = setup()
  await expect.poll(() => vi.mocked(useWakeLock).mock.lastCall).toEqual([true])
  rerender({ open: false })
  await expect.poll(() => vi.mocked(useWakeLock).mock.lastCall).toEqual([false])
})

function setupReporting(initial: { open: boolean; lyrics: string | null }) {
  const analytics = recordingAnalytics()
  const view = renderHook(
    (props: { open: boolean; lyrics: string | null }) => useLyricsReader({ ...props, tuneId }),
    { wrapper: dataProviders({ db, analytics }), initialProps: initial },
  )
  return { ...view, analytics }
}

const OPENED = { name: 'lyrics_opened', props: { tune_id: expect.any(String) } }

it('reports lyrics_opened once when the reader opens on words', async () => {
  const { rerender, analytics } = setupReporting({ open: false, lyrics: WORDS })
  expect(analytics.sends()).toEqual([])
  rerender({ open: true, lyrics: WORDS })
  await expect.poll(() => analytics.sends()).toEqual([OPENED])
  rerender({ open: true, lyrics: `${WORDS}\nMore` })
  expect(analytics.sends()).toHaveLength(1)
})

it('reports when lyrics arrive while the reader is open, once', async () => {
  const { rerender, analytics } = setupReporting({ open: true, lyrics: null })
  expect(analytics.sends()).toEqual([])
  rerender({ open: true, lyrics: WORDS })
  await expect.poll(() => analytics.sends()).toEqual([OPENED])
  rerender({ open: true, lyrics: null })
  rerender({ open: true, lyrics: WORDS })
  expect(analytics.sends()).toHaveLength(1)
})

it('reports again for the next opening', async () => {
  const { rerender, analytics } = setupReporting({ open: true, lyrics: WORDS })
  await expect.poll(() => analytics.sends()).toHaveLength(1)
  rerender({ open: false, lyrics: WORDS })
  rerender({ open: true, lyrics: WORDS })
  await expect.poll(() => analytics.sends()).toHaveLength(2)
})
