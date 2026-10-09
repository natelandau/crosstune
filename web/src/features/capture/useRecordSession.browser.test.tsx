import { act, renderHook } from '@testing-library/react'
import { recordingAnalytics } from '../../usage/testing'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Source } from '../../usage/events'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { fakeStream, FakeRecorder, LAST_CHUNK, fakeMediaForTest } from '../../test/fakeMedia'
import { dataProviders } from '../../test/providers'
import type { ConfirmQuestion } from '../../ui/confirmQuestion'
import { appendChunk, beginCapture } from '../../commands/recordings'
import { newId } from '../../commands/write'
import { createSyncEngine } from '../../sync/engine'
import { STALE_CAPTURE_MS } from '../../sync/transfers'
import { createFakeApi } from '../../test/fakeApi'
import { DISCARD_TITLE, STARTING_MICROPHONE } from './recordCopy'
import { RECORDING } from '../../text/format'
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
    source = 'dock',
  }: {
    tuneId?: string | null
    source?: Source
    answer?: boolean
    ask?: (question: ConfirmQuestion) => Promise<boolean>
  } = {},
) {
  const confirm = vi.fn(ask)
  const toast = vi.fn((_message: string) => {})
  const onDone = vi.fn((_saved: SavedRecording | null) => {})
  const onSaving = vi.fn((_recordingId: string) => {})
  const analytics = recordingAnalytics()
  const hook = renderHook(
    () => useRecordSession({ tuneId, source, confirm, toast, onDone, onSaving }),
    { wrapper: dataProviders({ db, analytics }) },
  )
  return { ...hook, confirm, toast, onDone, onSaving, analytics }
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
  describe('analytics', () => {
    it('sends recording_started with the launcher source once capture begins', async () => {
      fakeMedia()
      const { result, analytics } = setup(openTestDb(), { source: 'tune' })
      await expect.poll(() => result.current.phase).toBe('recording')

      await expect
        .poll(() => analytics.sends())
        .toEqual([{ name: 'recording_started', props: { source: 'tune' } }])
    })

    it('sends microphone_denied and no recording_started when permission is denied', async () => {
      const media = fakeMedia()
      media.getUserMedia.mockRejectedValueOnce(
        Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
      )
      const { result, analytics } = setup(openTestDb(), { source: 'menu' })
      await expect.poll(() => result.current.phase).toBe('denied')

      await expect
        .poll(() => analytics.sends())
        .toEqual([{ name: 'microphone_denied', props: { source: 'menu' } }])
    })

    it('sends nothing when the microphone fails for another reason', async () => {
      const media = fakeMedia()
      media.getUserMedia.mockRejectedValueOnce(
        Object.assign(new Error('busy'), { name: 'NotReadableError' }),
      )
      const { result, analytics } = setup(openTestDb())
      await expect.poll(() => result.current.phase).toBe('denied')

      expect(analytics.sends()).toEqual([])
    })

    it('sends recording_saved filed under the tune with a duration bucket and ids', async () => {
      fakeMedia()
      const db = openTestDb()
      const { tuneId } = await createTune(db, { title: "Soldier's Joy" }, { status: 'known' })
      const { result, onDone, analytics } = setup(db, { tuneId })
      await expect.poll(() => result.current.phase).toBe('recording')

      await act(() => result.current.stop())
      await expect.poll(() => onDone.mock.calls.length).toBe(1)

      const [saved] = await db.recordings.toArray()
      await expect
        .poll(() => analytics.sends())
        .toEqual([
          { name: 'recording_started', props: { source: 'dock' } },
          {
            name: 'recording_saved',
            props: {
              duration_bucket: '<30s',
              filed: true,
              recording_id: saved!.id,
              tune_id: tuneId,
            },
          },
        ])
    })

    it('sends recording_saved unfiled without a tune id', async () => {
      fakeMedia()
      const db = openTestDb()
      const { result, onDone, analytics } = setup(db)
      await expect.poll(() => result.current.phase).toBe('recording')

      await act(() => result.current.stop())
      await expect.poll(() => onDone.mock.calls.length).toBe(1)

      const [saved] = await db.recordings.toArray()
      await expect
        .poll(() => analytics.sends().at(-1))
        .toEqual({
          name: 'recording_saved',
          props: { duration_bucket: '<30s', filed: false, recording_id: saved!.id },
        })
    })

    it('sends recording_discarded with the duration bucket after a confirmed discard', async () => {
      fakeMedia()
      const db = openTestDb()
      const { result, onDone, analytics } = setup(db)
      await expect.poll(() => result.current.phase).toBe('recording')

      await act(() => result.current.discard())
      await expect.poll(() => onDone.mock.calls).toEqual([[null]])

      await expect
        .poll(() => analytics.sends())
        .toEqual([
          { name: 'recording_started', props: { source: 'dock' } },
          { name: 'recording_discarded', props: { duration_bucket: '<30s' } },
        ])
    })

    it('sends no recording_discarded when the discard is declined or the mic never started', async () => {
      const media = fakeMedia()
      const { result, confirm, analytics } = setup(openTestDb(), { answer: false })
      await expect.poll(() => result.current.phase).toBe('recording')
      await act(() => result.current.discard())
      await expect.poll(() => confirm.mock.calls.length).toBe(1)

      await expect
        .poll(() => analytics.sends().map((send) => send.name))
        .toEqual(['recording_started'])
      media.getUserMedia.mockImplementationOnce(() => new Promise(() => {}))
      const pending = setup(openTestDb())
      await expect.poll(() => pending.result.current.statusLabel).toBe(STARTING_MICROPHONE)
      await act(() => pending.result.current.discard())
      await expect.poll(() => pending.onDone.mock.calls).toEqual([[null]])

      expect(pending.analytics.sends()).toEqual([])
    })

    it('finishes an orphaned capture when a sync pass runs', async () => {
      const db = openTestDb()
      const id = newId()
      await beginCapture(db, id, { tuneId: null, recordedAt: new Date(0).toISOString() })
      await appendChunk(db, id, 0, new Blob(['a'], { type: 'audio/mp4' }))
      await db.recording_files.update(id, { last_chunk_at: Date.now() - STALE_CAPTURE_MS - 1 })

      const analytics = recordingAnalytics()
      const engine = createSyncEngine({
        analytics,
        db,
        api: createFakeApi().api,
        isOnline: () => true,
      })
      onTestFinished(() => engine.stop())
      await engine.sync()

      await expect
        .poll(async () => (await db.recording_files.get(id))?.local_state)
        .not.toBe('capturing')
      // Only the recorder that took the audio reports it; a recovered capture is no new save.
      expect(analytics.sends().filter((send) => send.name === 'recording_saved')).toEqual([])
    })

    it('sends recording_saved for a take kept when the recorder goes away mid-take', async () => {
      fakeMedia()
      const db = openTestDb()
      const { result, unmount, analytics } = setup(db)
      await expect.poll(() => result.current.phase).toBe('recording')

      unmount()

      await expect.poll(async () => (await db.recordings.toArray()).length).toBe(1)
      const [saved] = await db.recordings.toArray()
      await expect
        .poll(() => analytics.sends())
        .toEqual([
          { name: 'recording_started', props: { source: 'dock' } },
          {
            name: 'recording_saved',
            props: { duration_bucket: '<30s', filed: false, recording_id: saved!.id },
          },
        ])
    })

    it('reports a stopped take once, though the recorder goes away afterwards', async () => {
      fakeMedia()
      const db = openTestDb()
      const { result, onDone, unmount, analytics } = setup(db)
      await expect.poll(() => result.current.phase).toBe('recording')
      await act(() => result.current.stop())
      await expect.poll(() => onDone.mock.calls.length).toBe(1)

      unmount()

      await expect.poll(async () => (await db.recordings.toArray()).length).toBe(1)
      await expect
        .poll(() => analytics.sends().filter((send) => send.name === 'recording_saved').length)
        .toBe(1)
    })
  })
})
