import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTune } from '../../commands/tunes'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlaybackEngine } from '../../test/providers'
import { captureRecording } from '../../test/recordings'
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
