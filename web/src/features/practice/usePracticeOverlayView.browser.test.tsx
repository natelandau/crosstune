import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteSavedPlace, renameSavedPlace } from '../../commands/places'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlaybackEngine } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
import { placeRow } from '../../test/rows'
import { PlaybackEngineContext } from '../player/PlaybackEngineProvider'
import { PlayerProvider } from '../player/PlayerProvider'
import { formatDuration, recordingDateLabel } from '../../text/format'
import { PracticeOverlayStateProvider } from './PracticeOverlayState'
import { TRIM_CHANGED_ELSEWHERE } from './trimViewCopy'
import { usePracticeOverlayView } from './usePracticeOverlayView'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

function setup(id: string) {
  const Data = dataProviders({ db })
  const engine = fakePlaybackEngine()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlaybackEngineContext.Provider value={engine}>
        <PlayerProvider>
          <PracticeOverlayStateProvider>{children}</PracticeOverlayStateProvider>
        </PlayerProvider>
      </PlaybackEngineContext.Provider>
    </Data>
  )
  return renderHook(() => usePracticeOverlayView(id), { wrapper })
}

describe('usePracticeOverlayView', () => {
  it("titles practice with the tune's name and the recording's date and length", async () => {
    const { tuneId } = await createTune(db, { title: 'Cluck Old Hen' }, { status: 'learning' })
    const id = await captureRecording(db, { tuneId, durationMs: 3000, label: null })
    const { result } = setup(id)
    await expect.poll(() => result.current.view?.recording.id).toBe(id)
    const recording = result.current.view!.recording
    expect(result.current.title).toBe('Cluck Old Hen')
    expect(result.current.subtitle).toBe(
      `${recordingDateLabel(recording)} · ${formatDuration(3000)}`,
    )
    expect(result.current.rowLengthMs).toBe(3000)
    await expect.poll(() => result.current.audio).toBe('held')
  })

  it('adds the players to the subtitle and hands the place over as the location', async () => {
    const id = await captureRecording(db, { durationMs: 3000, players: 'Kevin and Ed' })
    await db.recordings.update(id, { place_name: 'Galax, VA', place_lat: 36.66, place_lon: -80.92 })
    const { result } = setup(id)
    await expect.poll(() => result.current.view?.recording.id).toBe(id)
    const recording = result.current.view!.recording
    expect(result.current.subtitle).toBe(
      `${recordingDateLabel(recording)} · ${formatDuration(3000)} · Kevin and Ed`,
    )
    expect(result.current.location).toBe('Galax, VA')
  })

  it('shows the saved location name, following a rename, even when the recording has no name', async () => {
    await db.places.put(placeRow('p1', 'Town Hall'))
    const id = await captureRecording(db, { durationMs: 3000 })
    await db.recordings.update(id, { place_id: 'p1', place_name: null })
    const { result } = setup(id)
    await expect.poll(() => result.current.location).toBe('Town Hall')
    await renameSavedPlace(db, 'p1', 'Guild Hall')
    await expect.poll(() => result.current.location).toBe('Guild Hall')
    await deleteSavedPlace(db, 'p1')
    await expect.poll(() => result.current.location).toBeNull()
  })

  it('has no location for a recording with no place', async () => {
    const id = await captureRecording(db)
    const { result } = setup(id)
    await expect.poll(() => result.current.view?.recording.id).toBe(id)
    expect(result.current.location).toBeNull()
  })

  it('opens the edit sheet on the form, or on the location page', async () => {
    const id = await captureRecording(db)
    const { result } = setup(id)
    await expect.poll(() => result.current.view).not.toBeNull()
    act(() => result.current.openLocation())
    expect(result.current.editing?.recording.id).toBe(id)
    expect(result.current.editPage).toBe('location')
    act(() => result.current.setEditing(null))
    expect(result.current.editing).toBeNull()
    act(() => result.current.setEditing(result.current.view))
    expect(result.current.editPage).toBeUndefined()
  })

  it('leaves a trim written elsewhere with a notice that the next trim clears', async () => {
    const id = await captureRecording(db)
    const { result } = setup(id)
    await expect.poll(() => result.current.view).not.toBeNull()
    act(() => result.current.openTrim())
    await expect.poll(() => result.current.shows).toBe('trim')
    act(() => result.current.trimmedElsewhere())
    await expect.poll(() => result.current.shows).toBe('main')
    expect(result.current.trimNotice).toBe(TRIM_CHANGED_ELSEWHERE)
    act(() => result.current.openTrim())
    await expect.poll(() => result.current.trimNotice).toBeNull()
  })
})
