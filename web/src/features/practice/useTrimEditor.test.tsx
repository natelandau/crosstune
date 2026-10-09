import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { recordingAnalytics } from '../../usage/testing'
import { updateRecording } from '../../commands/recordings'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, FakeAudioElement, fakePlaybackEngine } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import type { EngineClock } from '../player/playbackEngine'
import type { RecordingView } from '../recordings/useRecordings'
import { TRIM_CONFIRM_TITLE } from './trimViewCopy'
import { useTrimEditor } from './useTrimEditor'

vi.mock('../../commands/recordings', { spy: true })

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const LENGTH_MS = 30_000

/** A clock the test ticks by hand, so the engine reports a position only when told. */
function manualClock() {
  let tick = () => {}
  const clock: EngineClock = {
    every: (_ms, fn) => {
      tick = fn
      return () => {}
    },
    after: () => () => {},
  }
  return { clock, tick: () => tick() }
}

async function setup(confirm: (question: ConfirmQuestion) => Promise<boolean> = async () => true) {
  const id = await captureRecording(db, { durationMs: LENGTH_MS })
  vi.mocked(updateRecording).mockClear()
  const view: RecordingView = {
    recording: (await db.recordings.get(id))!,
    file: await db.recording_files.get(id),
    tuneId: null,
    tuneTitle: null,
  }
  const element = new FakeAudioElement()
  const { clock, tick } = manualClock()
  const engine = fakePlaybackEngine(element as unknown as HTMLAudioElement, clock)
  onTestFinished(() => engine.dispose())
  engine.load(
    'blob:a',
    { fromS: 0, toS: LENGTH_MS / 1000, lengthMs: LENGTH_MS },
    { speedPercent: 100, pitchCents: 0 },
    { title: 'Jam' },
  )
  const analytics = recordingAnalytics()
  const onDone = vi.fn()
  const onTrimmedElsewhere = vi.fn()
  const rendered = renderHook(
    ({ view }: { view: RecordingView }) =>
      useTrimEditor({ view, engine, confirm, onDone, onTrimmedElsewhere, isTop: () => true }),
    { wrapper: dataProviders({ db, analytics }), initialProps: { view } },
  )
  return { id, view, element, engine, tick, onDone, onTrimmedElsewhere, analytics, ...rendered }
}

function press(key: string) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

describe('useTrimEditor', () => {
  it('plays the selection and stops at its end', async () => {
    const { element, engine, tick, result } = await setup()
    act(() => result.current.dispatch({ type: 'drag', handle: 'end', ms: 20_000 }))
    act(() => result.current.playSelection())
    expect(engine.getState().playing).toBe(true)
    expect(engine.getState().positionMs).toBe(0)
    element.currentTime = 19.98
    act(() => tick())
    expect(engine.getState().playing).toBe(false)
    expect(engine.getState().positionMs).toBe(20_000)
  })

  it('sets the end at the playhead with ]', async () => {
    const { engine, result } = await setup()
    act(() => engine.seek(20_000))
    act(() => press(']'))
    expect(result.current.trim.end).toBe(20_000)
    expect(result.current.changed).toBe(true)
  })

  it('writes nothing when the confirm is declined', async () => {
    const confirm = vi.fn(async () => false)
    const { id, result, onDone } = await setup(confirm)
    act(() => result.current.dispatch({ type: 'drag', handle: 'start', ms: 5000 }))
    await act(() => result.current.save())
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: TRIM_CONFIRM_TITLE(25_000) }),
    )
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect((await db.recordings.get(id))!.trim_start_ms).toBe(0)
  })

  it('calls onTrimmedElsewhere when a trim lands from elsewhere while open', async () => {
    const { view, rerender, onTrimmedElsewhere } = await setup()
    expect(onTrimmedElsewhere).not.toHaveBeenCalled()
    rerender({ view: { ...view, recording: { ...view.recording, trim_start_ms: 3000 } } })
    await waitFor(() => expect(onTrimmedElsewhere).toHaveBeenCalledTimes(1))
  })

  /** A confirm that never answers, holding the signal it was asked with. */
  function pendingConfirm() {
    const asked: { signal?: AbortSignal } = {}
    const confirm = (question: ConfirmQuestion) => {
      asked.signal = question.signal
      return new Promise<boolean>(() => {})
    }
    return { asked, confirm }
  }

  it('withdraws an open Save question when a trim lands from elsewhere', async () => {
    const { asked, confirm } = pendingConfirm()
    const { view, result, rerender } = await setup(confirm)
    act(() => result.current.dispatch({ type: 'drag', handle: 'start', ms: 5000 }))
    act(() => void result.current.save())
    await expect.poll(() => asked.signal).toBeDefined()
    expect(asked.signal!.aborted).toBe(false)
    rerender({ view: { ...view, recording: { ...view.recording, trim_start_ms: 3000 } } })
    await expect.poll(() => asked.signal!.aborted).toBe(true)
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
  })

  it('withdraws an open Save question when the editor goes', async () => {
    const { asked, confirm } = pendingConfirm()
    const { result, unmount } = await setup(confirm)
    act(() => result.current.dispatch({ type: 'drag', handle: 'start', ms: 5000 }))
    act(() => void result.current.save())
    await expect.poll(() => asked.signal).toBeDefined()
    unmount()
    await expect.poll(() => asked.signal!.aborted).toBe(true)
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
  })

  it('Space plays the selection, and pauses it again', async () => {
    const { engine } = await setup()
    act(() => press(' '))
    expect(engine.getState().playing).toBe(true)
    act(() => press(' '))
    expect(engine.getState().playing).toBe(false)
  })

  it('sends recording_trimmed once the trim is written', async () => {
    const { id, result, onDone, analytics } = await setup()
    act(() => result.current.dispatch({ type: 'drag', handle: 'start', ms: 5000 }))
    await act(() => result.current.save())

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
    expect(analytics.sends()).toEqual([{ name: 'recording_trimmed', props: { recording_id: id } }])
  })

  it('sends nothing when the trim is declined or the write fails', async () => {
    const declined = await setup(async () => false)
    act(() => declined.result.current.dispatch({ type: 'drag', handle: 'start', ms: 5000 }))
    await act(() => declined.result.current.save())
    expect(vi.mocked(updateRecording)).not.toHaveBeenCalled()
    expect(declined.analytics.sends()).toEqual([])

    const failing = await setup()
    vi.mocked(updateRecording).mockRejectedValueOnce(new Error('nope'))
    act(() => failing.result.current.dispatch({ type: 'drag', handle: 'start', ms: 5000 }))
    await act(() => failing.result.current.save())
    await waitFor(() => expect(failing.result.current.error).not.toBeNull())
    expect(failing.analytics.sends()).toEqual([])
  })
})
