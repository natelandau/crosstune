import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as recordingCommands from '../../commands/recordings'
import {
  appendChunk,
  beginCapture,
  finishCapture,
  defaultRecordingLabel,
} from '../../commands/recordings'
import { newId } from '../../commands/write'
import type { CrosstuneDb } from '../../db/schema'
import { captureLockName } from '../../sync/captureLock'
import { openTestDb } from '../../test/db'
import { FakeLockManager } from '../../test/fakeLocks'
import type { FakeTrack } from '../../test/fakeMedia'
import { FakeRecorder, fakeStream, LAST_CHUNK, stubMediaGlobals } from '../../test/fakeMedia'
import { renderApp } from '../../test/render'
import { unlockAudioContext } from './audioContext'

let db: CrosstuneDb
let track: FakeTrack

async function heldLocks(locks: FakeLockManager): Promise<(string | undefined)[]> {
  return ((await locks.query()).held ?? []).map((lock) => lock.name)
}

function stubLocks(): FakeLockManager {
  const locks = new FakeLockManager()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
  return locks
}

beforeEach(() => {
  db = openTestDb()
  ;({ track } = stubMediaGlobals())
  // These tests navigate to /record directly rather than through a Record button tap;
  // a real navigation there always follows one, so match that starting point.
  unlockAudioContext()
})

function getUserMedia(): ReturnType<typeof vi.fn> {
  return navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>
}

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'locks')
  await db.delete()
})

describe('RecordingScreen', () => {
  it('starts recording on mount at the preset bit rate and saves on stop', async () => {
    const { router } = renderApp({ db, path: '/record' })
    await screen.findByRole('timer')
    expect(FakeRecorder.instances[0]?.options.audioBitsPerSecond).toBe(64_000)
    expect(FakeRecorder.instances[0]?.options.mimeType).toBe('audio/mp4')
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/recordings'))
    const [row] = await db.recordings.toArray()
    expect(row).toMatchObject({ song_id: null, source: 'microphone' })
    expect(row?.label).toBe(defaultRecordingLabel(row!.recorded_at))
    expect(row?.label).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(await screen.findByRole('list', { name: 'Unfiled' })).toHaveTextContent(row!.label!)
    expect((await db.recording_files.get(row!.id))?.local_state).toBe('captured')
    expect(navigator.storage.persist).toHaveBeenCalledTimes(1)
  })

  it('shows the interruption when the track mutes', async () => {
    renderApp({ db, path: '/record' })
    await screen.findByRole('timer')
    act(() => track.dispatchEvent(new Event('mute')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Recording interrupted')
    act(() => track.dispatchEvent(new Event('unmute')))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('explains a denied microphone', async () => {
    getUserMedia().mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    )
    renderApp({ db, path: '/record' })
    expect(await screen.findByRole('alert')).toHaveTextContent('microphone')
    expect(await db.recording_files.count()).toBe(0)
    expect(navigator.storage.persist).not.toHaveBeenCalled()
  })

  it('cancel discards the recording after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { router } = renderApp({ db, path: '/record' })
    await screen.findByRole('timer')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await db.recording_files.count()).toBe(0)
    expect(await db.recordings.count()).toBe(0)
  })

  it('saves the recording when the microphone track ends on its own', async () => {
    renderApp({ db, path: '/record' })
    await screen.findByRole('timer')
    act(() => track.dispatchEvent(new Event('ended')))
    await screen.findByRole('heading', { name: 'Recordings' })
    const [row] = await db.recordings.toArray()
    expect((await db.recording_files.get(row!.id))?.local_state).toBe('captured')
  })

  it('keeps the recording and warns when part of it could not be written', async () => {
    vi.spyOn(db.recording_chunks, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'))
    renderApp({ db, path: '/record' })
    await screen.findByRole('timer')
    act(() => FakeRecorder.instances[0]!.emit('early'))
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await screen.findByRole('heading', { name: 'Recordings' })
    expect(
      await screen.findByText('Part of this recording could not be saved.'),
    ).toBeInTheDocument()
    const [row] = await db.recordings.toArray()
    const file = await db.recording_files.get(row!.id)
    expect(file?.local_state).toBe('captured')
    expect(file?.bytes).toBe(LAST_CHUNK.length)
  })

  it('holds the capture lock from before the recording begins until it is saved', async () => {
    const locks = stubLocks()
    const put = db.recording_files.put.bind(db.recording_files)
    let heldAtBegin: (string | undefined)[] = []
    vi.spyOn(db.recording_files, 'put').mockImplementationOnce((file) =>
      Dexie.Promise.resolve(heldLocks(locks)).then((held) => {
        heldAtBegin = held
        return put(file)
      }),
    )
    const { router } = renderApp({ db, path: '/record' })
    await screen.findByRole('timer')
    const [file] = await db.recording_files.toArray()
    expect(heldAtBegin).toEqual([captureLockName(file!.id)])
    expect(await heldLocks(locks)).toEqual([captureLockName(file!.id)])
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/recordings'))
    await waitFor(async () => expect(await heldLocks(locks)).toEqual([]))
  })

  it('keeps the recording, releases the lock, and stops the microphone when navigated away', async () => {
    const locks = stubLocks()
    const { router } = renderApp({ db, path: '/record' })
    await screen.findByRole('timer')
    expect(await heldLocks(locks)).toHaveLength(1)
    await act(() => router.navigate({ to: '/' }))
    await waitFor(() => expect(track.stop).toHaveBeenCalled())
    await waitFor(async () => expect(await heldLocks(locks)).toEqual([]))
    await waitFor(async () => expect(await db.recordings.count()).toBe(1))
    const [row] = await db.recordings.toArray()
    expect((await db.recording_files.get(row!.id))?.local_state).toBe('captured')
  })

  it('stamps the recording with the time it started, not the time it stopped', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const startedAt = new Date('2026-09-15T20:00:00.000Z')
    vi.setSystemTime(startedAt)
    renderApp({ db, path: '/record' })
    await screen.findByRole('timer')
    vi.setSystemTime(startedAt.getTime() + 60_000)
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await screen.findByRole('heading', { name: 'Recordings' })
    const [row] = await db.recordings.toArray()
    expect(row?.recorded_at).toBe(startedAt.toISOString())
  })

  it('starts one live recording under StrictMode', async () => {
    const put = vi.spyOn(db.recording_files, 'put')
    renderApp({ db, path: '/record', strict: true })
    await screen.findByRole('timer')
    expect(getUserMedia()).toHaveBeenCalledTimes(1)
    expect(track.stop).not.toHaveBeenCalled()
    expect(FakeRecorder.instances).toHaveLength(1)
    expect(put).toHaveBeenCalledTimes(1)
    expect(await db.recording_files.count()).toBe(1)
    expect(await db.recordings.count()).toBe(0)
  })

  it('cancel while the microphone prompt is open records nothing and stops the late stream', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    let grant: (stream: ReturnType<typeof fakeStream>) => void = () => {}
    getUserMedia().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve
        }),
    )
    const { router } = renderApp({ db, path: '/record' })
    await waitFor(() => expect(getUserMedia()).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(confirm).not.toHaveBeenCalled()
    await act(async () => grant(fakeStream(track)))
    await waitFor(() => expect(track.stop).toHaveBeenCalled())
    expect(FakeRecorder.instances).toHaveLength(0)
    expect(await db.recording_files.count()).toBe(0)
  })

  it('makes one recording from two taps on Stop', async () => {
    const finish = vi.spyOn(recordingCommands, 'finishCapture')
    renderApp({ db, path: '/record' })
    await screen.findByRole('timer')
    const stop = screen.getByRole('button', { name: 'Stop' })
    act(() => {
      stop.click()
      stop.click()
    })
    await screen.findByRole('heading', { name: 'Recordings' })
    expect(finish).toHaveBeenCalledTimes(1)
    expect(await db.recordings.count()).toBe(1)
  })

  it('leaves a recording it cannot finish for sync recovery and says so', async () => {
    const finish = vi
      .spyOn(recordingCommands, 'finishCapture')
      .mockRejectedValue(new Error('AbortError'))
    renderApp({ db, path: '/record' })
    await screen.findByRole('timer')
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The recording could not be saved. It will be recovered the next time the app syncs.',
    )
    expect(finish).toHaveBeenCalledTimes(2)
    const [file] = await db.recording_files.toArray()
    expect(file?.local_state).toBe('capturing')
    expect(await db.recording_chunks.count()).toBe(1)
  })

  it('is full-screen: no dock navigation or player region', async () => {
    renderApp({ db, path: '/record' })
    await screen.findByRole('timer')
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
  })

  it('closes a playing player before starting a new recording', async () => {
    const id = newId()
    await beginCapture(db, id, { songId: null, recordedAt: '2026-09-14T20:00:00.000Z' })
    await appendChunk(db, id, 0, new Blob(['abc'], { type: 'audio/mp4' }))
    await finishCapture(db, id, {
      songId: null,
      mime: 'audio/mp4',
      durationMs: 3000,
      recordedAt: '2026-09-14T20:00:00.000Z',
    })
    const { router } = renderApp({ db, path: '/recordings' })
    const list = await screen.findByRole('list', { name: 'Unfiled' })
    await userEvent.click(within(list).getByRole('button', { name: /^Play / }))
    await screen.findByRole('region', { name: 'Player' })
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', {
        name: 'Start a new recording',
      }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/record'))
    expect(screen.queryByRole('region', { name: 'Player' })).toBeNull()
  })
})
