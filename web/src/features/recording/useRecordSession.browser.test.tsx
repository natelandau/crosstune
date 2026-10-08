import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { fakeStream, FakeRecorder, LAST_CHUNK, fakeMediaForTest } from '../../test/fakeMedia'
import { dataProviders } from '../../test/providers'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import { DISCARD_TITLE, STARTING_MICROPHONE } from './recordCopy'
import { RECORDING } from './format'
import { type SavedRecording, useRecordSession } from './useRecordSession'

/** Every browser global a recording touches, faked; each one is put back when the test ends. */
function fakeMedia() {
  const { track, getUserMedia } = fakeMediaForTest()
  return { getUserMedia, stream: () => fakeStream(track) }
}

function setup(
  db: CrosstuneDb,
  {
    tuneId = null,
    answer = true,
    ask = async () => answer,
  }: {
    tuneId?: string | null
    answer?: boolean
    ask?: (question: ConfirmQuestion) => Promise<boolean>
  } = {},
) {
  const confirm = vi.fn(ask)
  const toast = vi.fn((_message: string) => {})
  const onDone = vi.fn((_saved: SavedRecording | null) => {})
  const onSaving = vi.fn((_recordingId: string) => {})
  const hook = renderHook(() => useRecordSession({ tuneId, confirm, toast, onDone, onSaving }), {
    wrapper: dataProviders({ db }),
  })
  return { ...hook, confirm, toast, onDone, onSaving }
}

describe('useRecordSession', () => {
  it('asks before discarding once started, and keeps recording when refused', async () => {
    fakeMedia()
    const { result, confirm, onDone } = setup(openTestDb(), { answer: false })
    await expect.poll(() => result.current.phase).toBe('recording')
    expect(result.current.started).toBe(true)
    expect(result.current.statusLabel).toBe(RECORDING)

    await act(() => result.current.discard())

    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0]![0]).toMatchObject({ title: DISCARD_TITLE })
    expect(result.current.phase).toBe('recording')
    expect(result.current.refuseDismiss).toBe(true)
    expect(FakeRecorder.instances[0]!.state).toBe('recording')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('discards without asking while the microphone is still starting', async () => {
    const media = fakeMedia()
    media.getUserMedia.mockImplementationOnce(() => new Promise(() => {}))
    const { result, confirm, onDone } = setup(openTestDb())
    await expect.poll(() => result.current.statusLabel).toBe(STARTING_MICROPHONE)
    expect(result.current.started).toBe(false)

    await act(() => result.current.discard())

    expect(confirm).not.toHaveBeenCalled()
    await expect.poll(() => onDone.mock.calls).toEqual([[null]])
  })

  it('ignores a stop while the microphone is still starting, so a discard still works', async () => {
    const media = fakeMedia()
    media.getUserMedia.mockImplementationOnce(() => new Promise(() => {}))
    const { result, onDone } = setup(openTestDb())
    await expect.poll(() => result.current.statusLabel).toBe(STARTING_MICROPHONE)

    await act(() => result.current.stop())
    expect(result.current.phase).toBe('starting')
    await act(() => result.current.discard())

    await expect.poll(() => onDone.mock.calls).toEqual([[null]])
  })

  it('reports the saved recording with its id and tune', async () => {
    fakeMedia()
    const db = openTestDb()
    const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
    const { result, onDone, toast } = setup(db, { tuneId })
    await expect.poll(() => result.current.phase).toBe('recording')

    await act(() => result.current.stop())

    await expect.poll(() => onDone.mock.calls.length).toBe(1)
    const saved = await db.recordings.toArray()
    expect(saved).toHaveLength(1)
    expect(onDone.mock.calls[0]![0]).toEqual({ tuneId, recordingId: saved[0]!.id })
    expect(result.current.refuseDismiss).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })

  it('leaves the save report alone when a discard comes during or after the save', async () => {
    fakeMedia()
    const db = openTestDb()
    const { result, confirm, onDone } = setup(db)
    await expect.poll(() => result.current.phase).toBe('recording')

    // Both read the same render, as a Stop and a Cancel pressed in one tick would.
    const { stop, discard } = result.current
    await act(async () => {
      const saving = stop()
      await discard()
      await saving
    })
    await expect.poll(() => onDone.mock.calls.length).toBe(1)
    await act(() => result.current.discard())

    const [saved] = await db.recordings.toArray()
    expect(onDone.mock.calls).toEqual([[{ tuneId: null, recordingId: saved!.id }]])
    expect(confirm).not.toHaveBeenCalled()
  })

  it('withdraws an open discard question when the recording is stopped', async () => {
    fakeMedia()
    const db = openTestDb()
    let signal: AbortSignal | undefined
    // Answers only when withdrawn, as a dialog left open would.
    const ask = (question: ConfirmQuestion) =>
      new Promise<boolean>((resolve) => {
        signal = question.signal
        question.signal?.addEventListener('abort', () => resolve(false))
      })
    const { result, onDone } = setup(db, { ask })
    await expect.poll(() => result.current.phase).toBe('recording')

    let discarding: Promise<void> = Promise.resolve()
    act(() => {
      discarding = result.current.discard()
    })
    await expect.poll(() => signal).toBeDefined()
    await act(() => result.current.stop())
    await act(() => discarding)

    expect(signal!.aborted).toBe(true)
    await expect.poll(() => onDone.mock.calls.length).toBe(1)
    const [saved] = await db.recordings.toArray()
    expect(onDone.mock.calls).toEqual([[{ tuneId: null, recordingId: saved!.id }]])
  })

  it('is held open through the save, and a discard during it changes nothing', async () => {
    fakeMedia()
    const db = openTestDb()
    const { result, confirm, onDone } = setup(db)
    await expect.poll(() => result.current.phase).toBe('recording')
    // Holds the recorder's last chunk until released, so the save stays in progress.
    const recorder = FakeRecorder.instances[0]!
    let release = () => {}
    recorder.stop = () => {
      recorder.state = 'inactive'
      release = () => {
        recorder.emit(LAST_CHUNK)
        recorder.dispatchEvent(new Event('stop'))
      }
    }

    act(() => void result.current.stop())
    await expect.poll(() => result.current.phase).toBe('saving')
    expect(result.current.refuseDismiss).toBe(true)
    await act(() => result.current.discard())
    expect(confirm).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()

    act(() => release())
    await expect.poll(() => result.current.phase).toBe('saved')
    expect(result.current.refuseDismiss).toBe(false)
    const [saved] = await db.recordings.toArray()
    await expect.poll(() => onDone.mock.calls).toEqual([[{ tuneId: null, recordingId: saved!.id }]])
  })

  it('names the take Stop is saving before the save ends, under the id the save reports', async () => {
    fakeMedia()
    const db = openTestDb()
    const { result, onDone, onSaving } = setup(db)
    await expect.poll(() => result.current.phase).toBe('recording')
    // Holds the recorder's last chunk until released, so the save stays in progress.
    const recorder = FakeRecorder.instances[0]!
    let release = () => {}
    recorder.stop = () => {
      recorder.state = 'inactive'
      release = () => {
        recorder.emit(LAST_CHUNK)
        recorder.dispatchEvent(new Event('stop'))
      }
    }

    act(() => void result.current.stop())
    await expect.poll(() => result.current.phase).toBe('saving')
    expect(onSaving).toHaveBeenCalledOnce()
    expect(onDone).not.toHaveBeenCalled()
    expect(await db.recordings.count()).toBe(0)

    act(() => release())
    await expect.poll(() => onDone.mock.calls.length).toBe(1)
    expect(onDone.mock.calls[0]![0]?.recordingId).toBe(onSaving.mock.calls[0]![0])
  })
})
