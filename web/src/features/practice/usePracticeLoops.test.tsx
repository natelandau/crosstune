import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_ROOM } from '../../commands/messages'
import type { CrosstuneDb } from '../../db/schema'
import { openTestDb } from '../../test/db'
import { dataProviders, fakePlaybackEngine } from '../../test/providers'
import { captureRecording, seedLoop } from '../../test/recordings'
import type { PlaybackEngine } from '../player/playbackEngine'
import { PlaybackEngineContext } from '../player/PlaybackEngineProvider'
import type { RecordingView } from '../recordings/useRecordings'
import { LOOP_SELECTED } from './practiceCopy'
import { usePracticeLoops } from './usePracticeLoops'
import { usePracticeTimeline } from './usePracticeTimeline'

let db: CrosstuneDb

beforeEach(() => {
  db = openTestDb()
})

const LENGTH_MS = 180_000

async function setup() {
  const id = await captureRecording(db, { durationMs: LENGTH_MS })
  const view: RecordingView = {
    recording: (await db.recordings.get(id))!,
    file: await db.recording_files.get(id),
    tuneId: null,
    tuneTitle: null,
  }
  const engine = fakePlaybackEngine()
  engine.load(
    'blob:a',
    { fromS: 0, toS: LENGTH_MS / 1000, lengthMs: LENGTH_MS },
    { speedPercent: 100, pitchCents: 0 },
    { title: 'Jam' },
  )
  const Data = dataProviders({ db })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Data>
      <PlaybackEngineContext.Provider value={engine}>{children}</PlaybackEngineContext.Provider>
    </Data>
  )
  return { id, view, engine, wrapper }
}

/** Both hooks as Practice calls them. */
function render(
  view: RecordingView,
  engine: PlaybackEngine,
  wrapper: ReturnType<typeof dataProviders>,
) {
  return renderHook(
    () => {
      const timeline = usePracticeTimeline({ view, engine, size: { width: 400 } })
      const loops = usePracticeLoops({
        view,
        timeline,
        announce: timeline.announce,
        onError: vi.fn(),
      })
      return { timeline, loops }
    },
    { wrapper },
  )
}

describe('usePracticeLoops', () => {
  it('selects a tapped loop and says so', async () => {
    const { id, view, engine, wrapper } = await setup()
    const loopId = await seedLoop(db, id, 58_000, 111_000, { label: 'B part' })
    const { result } = render(view, engine, wrapper)
    await waitFor(() => expect(result.current.loops.rows).toHaveLength(1))

    act(() => result.current.loops.onTap(70_000))
    await waitFor(() => expect(engine.getState().loop?.id).toBe(loopId))
    await waitFor(() => expect(result.current.timeline.announcement).toBe(LOOP_SELECTED('B part')))
    expect(result.current.loops.selected?.name).toBe('B part')
  })

  it('returns why N made no loop where there is no room, and says it', async () => {
    const { id, view, engine, wrapper } = await setup()
    await seedLoop(db, id, 1_000, 5_000)
    await seedLoop(db, id, 5_200, 9_000)
    const { result } = render(view, engine, wrapper)
    await waitFor(() => expect(result.current.loops.rows).toHaveLength(2))

    let reason: string | null = null
    act(() => {
      reason = result.current.loops.createAt(5_100)
    })
    expect(reason).toBe(NO_ROOM)
    await waitFor(() => expect(result.current.timeline.announcement).toBe(NO_ROOM))
  })

  it('Fit moves a playhead outside the selected loop to its start', async () => {
    const { id, view, engine, wrapper } = await setup()
    const loopId = await seedLoop(db, id, 58_000, 111_000)
    const { result } = render(view, engine, wrapper)
    await waitFor(() => expect(result.current.loops.rows).toHaveLength(1))
    act(() => result.current.loops.playback.select(loopId))
    await waitFor(() => expect(result.current.loops.selected?.id).toBe(loopId))
    act(() => engine.seek(130_000))
    await waitFor(() => expect(engine.getState().positionMs).toBe(130_000))

    act(() => result.current.timeline.fit(result.current.loops.selected!.span))
    await waitFor(() => expect(engine.getState().positionMs).toBe(58_000))
  })

  it('opens fitted to the selected loop once the loops are read', async () => {
    const { id, view, engine, wrapper } = await setup()
    const loopId = await seedLoop(db, id, 58_000, 111_000)
    engine.setLoop({ id: loopId, label: 'Loop 0:58', fromS: 58, toS: 111 })
    const { result } = render(view, engine, wrapper)
    await waitFor(() => expect(result.current.timeline.scale).not.toBeNull())
    expect(result.current.loops.selected?.id).toBe(loopId)
    // The playhead sits before the loop, so the fit is taken from its start.
    expect(result.current.timeline.scale).toBeCloseTo(200 / ((53_000 * 1.1) / 1000))
  })

  it('its Fit frames the selected loop as a handle drag draws it', async () => {
    const { id, view, engine, wrapper } = await setup()
    const loopId = await seedLoop(db, id, 58_000, 111_000)
    const { result } = render(view, engine, wrapper)
    await waitFor(() => expect(result.current.loops.rows).toHaveLength(1))
    act(() => result.current.loops.playback.select(loopId))
    await waitFor(() => expect(result.current.loops.selected?.id).toBe(loopId))
    act(() => result.current.loops.onDraft({ id: loopId, startMs: 80_000, endMs: 111_000 }))
    await waitFor(() => expect(result.current.loops.selected?.span.startMs).toBe(80_000))
    act(() => engine.seek(130_000))
    await waitFor(() => expect(engine.getState().positionMs).toBe(130_000))

    act(() => result.current.loops.fit())
    await waitFor(() => expect(engine.getState().positionMs).toBe(80_000))
  })

  it('hands the keys N, which says why it made no loop', async () => {
    const { id, view, engine, wrapper } = await setup()
    await seedLoop(db, id, 1_000, 5_000)
    await seedLoop(db, id, 5_200, 9_000)
    const { result } = render(view, engine, wrapper)
    await waitFor(() => expect(result.current.loops.rows).toHaveLength(2))
    expect(result.current.loops.keyActions.canEdit).toBe(true)

    act(() => result.current.loops.keyActions.create(5_100))
    await waitFor(() => expect(result.current.timeline.announcement).toBe(NO_ROOM))
  })
})
