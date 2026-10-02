import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { LocalRecordingLoop } from '../../db/types'
import { FakeAudioElement } from '../../test/providers'
import { loopRow, recordingFile, recordingRow } from '../../test/rows'
import { PlaybackEngine, type EngineClock } from '../player/playbackEngine'
import { PlaybackEngineContext } from '../player/PlaybackEngineProvider'
import type { RecordingView } from '../recordings/useRecordings'
import { useLoopFollow } from './useLoopFollow'
import { useLoopPlayback } from './useLoopPlayback'

const quietClock: EngineClock = { every: () => () => {}, after: () => () => {} }

function setup() {
  const element = new FakeAudioElement()
  const engine = new PlaybackEngine(element as unknown as HTMLAudioElement, quietClock, () =>
    Promise.reject(new Error('no stage')),
  )
  engine.load(
    'blob:a',
    { fromS: 0, toS: 170, lengthMs: 170_000 },
    { speedPercent: 100, pitchCents: 0 },
    { title: 'Jam' },
  )
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlaybackEngineContext.Provider value={engine}>{children}</PlaybackEngineContext.Provider>
  )
  return { engine, element, wrapper }
}

function view(blobStartMs = 10_000, blobRev: string | null = null): RecordingView {
  return {
    recording: recordingRow('rec-1', { trim_start_ms: 10_000, source_duration_ms: 180_000 }),
    file: recordingFile('rec-1', { blob_start_ms: blobStartMs, blob_rev: blobRev }),
    tuneId: null,
    tuneTitle: null,
  }
}

const bPart = loopRow({ id: 'b', label: 'B part', start_ms: 58_000, end_ms: 111_000 })
const aPart = loopRow({ id: 'a', label: null, start_ms: 12_000, end_ms: 40_000 })

type Props = { view: RecordingView; loops: LocalRecordingLoop[] | undefined }

/** Practice's hook beside the dock's follower, as they run while Practice is open. */
function usePracticeAndDock({ view, loops }: Props) {
  useLoopFollow(loops, {
    blobStartMs: view.file?.blob_start_ms ?? 0,
    trimStartMs: view.recording.trim_start_ms,
  })
  return useLoopPlayback(view, loops)
}

function render(wrapper: ReturnType<typeof setup>['wrapper'], initialProps: Props) {
  return renderHook(usePracticeAndDock, { wrapper, initialProps })
}

describe('useLoopPlayback', () => {
  it('selects a loop and hands the engine its range in seconds into the loaded blob', () => {
    const { engine, wrapper } = setup()
    const { result } = render(wrapper, { view: view(), loops: [aPart, bPart] })
    expect(result.current.selectedId).toBeNull()

    act(() => result.current.select('b'))
    expect(result.current.selectedId).toBe('b')
    expect(engine.loopRange).toEqual({ id: 'b', label: 'B part', fromS: 48, toS: 101 })
    expect(engine.getState().loop).toEqual({ id: 'b', label: 'B part' })

    act(() => result.current.select('a'))
    // An unlabeled loop is named for its start on the trimmed timeline.
    expect(engine.getState().loop).toEqual({ id: 'a', label: 'Loop 0:02' })
  })

  it('keeps the selection when Practice is left and opened again', () => {
    const { wrapper } = setup()
    const first = render(wrapper, { view: view(), loops: [bPart] })
    act(() => first.result.current.select('b'))
    first.unmount()
    const again = render(wrapper, { view: view(), loops: [bPart] })
    expect(again.result.current.selectedId).toBe('b')
  })

  it('selects a loop that is not in the rows yet once it arrives', () => {
    const { engine, wrapper } = setup()
    const { result, rerender } = render(wrapper, { view: view(), loops: [aPart] })
    act(() => result.current.select('b'))
    expect(result.current.selectedId).toBe('b')
    rerender({ view: view(), loops: [aPart, bPart] })
    expect(result.current.selectedId).toBe('b')
    expect(engine.loopRange?.id).toBe('b')
  })

  it('follows a change to the selected loop’s span or label', () => {
    const { engine, wrapper } = setup()
    const { result, rerender } = render(wrapper, { view: view(), loops: [bPart] })
    act(() => result.current.select('b'))
    rerender({
      view: view(),
      loops: [{ ...bPart, start_ms: 60_000, end_ms: 100_000, label: 'B' }],
    })
    expect(engine.loopRange).toEqual({ id: 'b', label: 'B', fromS: 50, toS: 90 })
  })

  it('hands the range again once a new blob for the same recording has loaded', () => {
    const { engine, wrapper } = setup()
    const { result, rerender } = render(wrapper, { view: view(), loops: [bPart] })
    act(() => result.current.select('b'))

    // A trim landed: the dock loads the cut file, which starts 40 s into the source.
    act(() =>
      engine.load(
        'blob:b',
        { fromS: 0, toS: 100, lengthMs: 100_000 },
        { speedPercent: 100, pitchCents: 0 },
        { title: 'Jam' },
        { keepLoop: true },
      ),
    )
    rerender({ view: view(40_000, 'rev2'), loops: [bPart] })
    expect(engine.loopRange).toEqual({ id: 'b', label: 'B part', fromS: 18, toS: 71 })
    expect(engine.getState().repeat).toBe(true)
  })

  it('hands the range again when the reload lands after the file row changes', () => {
    const { engine, wrapper } = setup()
    const { result, rerender } = render(wrapper, { view: view(), loops: [bPart] })
    act(() => result.current.select('b'))
    rerender({ view: view(40_000, 'rev2'), loops: [bPart] })
    act(() =>
      engine.load(
        'blob:b',
        { fromS: 0, toS: 100, lengthMs: 100_000 },
        { speedPercent: 100, pitchCents: 0 },
        { title: 'Jam' },
        { keepLoop: true },
      ),
    )
    expect(engine.loopRange).toEqual({ id: 'b', label: 'B part', fromS: 18, toS: 71 })
  })

  it('clears the selection and Repeat when the selected loop is deleted', () => {
    const { engine, wrapper } = setup()
    const { result, rerender } = render(wrapper, { view: view(), loops: [aPart, bPart] })
    act(() => result.current.select('b'))
    expect(engine.getState().repeat).toBe(true)

    rerender({ view: view(), loops: [aPart] })
    expect(result.current.selectedId).toBeNull()
    expect(engine.getState().repeat).toBe(false)
    expect(engine.getState().loop).toBeNull()
    expect(engine.loopRange).toBeNull()
  })

  it('waits for the first read of the rows before clearing anything', () => {
    const { engine, wrapper } = setup()
    const first = render(wrapper, { view: view(), loops: [bPart] })
    act(() => first.result.current.select('b'))
    first.unmount()
    const again = render(wrapper, { view: view(), loops: undefined })
    expect(again.result.current.selectedId).toBe('b')
    expect(engine.getState().loop?.id).toBe('b')
  })

  it('repeats a selected loop and moves an outside playhead to its start', () => {
    const { engine, wrapper } = setup()
    const { result } = render(wrapper, { view: view(), loops: [aPart, bPart] })
    engine.seek(5_000)
    act(() => result.current.select('b'))
    expect(engine.getState().repeat).toBe(true)
    expect(engine.getState().positionMs).toBe(48_000)
  })

  it('moves an outside playhead to the start while playing too', () => {
    const { engine, wrapper } = setup()
    const { result } = render(wrapper, { view: view(), loops: [aPart, bPart] })
    engine.play()
    engine.seek(5_000)
    act(() => result.current.select('b'))
    expect(engine.getState().positionMs).toBe(48_000)
  })

  it('keeps the playhead when it is inside the selected loop', () => {
    const { engine, wrapper } = setup()
    const { result } = render(wrapper, { view: view(), loops: [aPart, bPart] })
    engine.seek(60_000)
    act(() => result.current.select('b'))
    expect(engine.getState().repeat).toBe(true)
    expect(engine.getState().positionMs).toBe(60_000)
  })

  it('moves to the start of another loop selected when outside it', () => {
    const { engine, wrapper } = setup()
    // Overlaps A, so a playhead inside both is not moved.
    const cPart = loopRow({ id: 'c', label: 'C part', start_ms: 30_000, end_ms: 50_000 })
    const { result } = render(wrapper, { view: view(), loops: [aPart, bPart, cPart] })
    act(() => result.current.select('a'))
    engine.seek(25_000)

    act(() => result.current.select('c'))
    expect(engine.loopRange?.id).toBe('c')
    expect(engine.getState().repeat).toBe(true)
    expect(engine.getState().positionMs).toBe(25_000)

    act(() => result.current.select('b'))
    expect(engine.getState().positionMs).toBe(48_000)
  })

  it('plays on straight through once deselected', () => {
    const { engine, wrapper } = setup()
    const { result } = render(wrapper, { view: view(), loops: [bPart] })
    act(() => result.current.select('b'))
    act(() => result.current.select(null))
    expect(result.current.selectedId).toBeNull()
    expect(engine.getState().loop).toBeNull()
    expect(engine.getState().repeat).toBe(false)
  })

  it('clears the selection and repeat when the selected loop is tombstoned', () => {
    const { engine, wrapper } = setup()
    const { result, rerender } = render(wrapper, { view: view(), loops: [bPart] })
    act(() => result.current.select('b'))
    // The live query drops a tombstoned row, so the loop is simply no longer in the list.
    rerender({ view: view(), loops: [] })
    expect(result.current.selectedId).toBeNull()
    expect(engine.getState().repeat).toBe(false)
    expect(engine.getState().loop).toBeNull()
  })

  it('plays a held span ahead of the row until the row catches up', () => {
    const { engine, wrapper } = setup()
    const { result, rerender } = render(wrapper, { view: view(), loops: [bPart] })
    act(() => result.current.select('b'))
    act(() => result.current.hold('b', { startMs: 70_000, endMs: 90_000 }))
    expect(engine.loopRange).toMatchObject({ fromS: 60, toS: 80 })
    // A tick, or any other engine change, leaves the held span in place.
    act(() => engine.seek(65_000))
    expect(engine.loopRange).toMatchObject({ fromS: 60, toS: 80 })
    rerender({ view: view(), loops: [{ ...bPart, start_ms: 70_000, end_ms: 90_000 }] })
    expect(engine.loopRange).toMatchObject({ fromS: 60, toS: 80 })
    // Once the row holds the span, a later change to the row is followed again.
    rerender({ view: view(), loops: [{ ...bPart, start_ms: 72_000, end_ms: 90_000 }] })
    expect(engine.loopRange).toMatchObject({ fromS: 62, toS: 80 })
  })

  it('follows the row once it moves to a third value while a hold is pending', () => {
    const { engine, wrapper } = setup()
    const { result, rerender } = render(wrapper, { view: view(), loops: [bPart] })
    act(() => result.current.select('b'))
    act(() => result.current.hold('b', { startMs: 70_000, endMs: 90_000 }))
    // A sync or a server re-clamp lands a value that is neither the old span nor the held one.
    rerender({ view: view(), loops: [{ ...bPart, start_ms: 75_000, end_ms: 95_000 }] })
    expect(engine.loopRange).toMatchObject({ fromS: 65, toS: 85 })
    act(() => engine.seek(80_000))
    expect(engine.loopRange).toMatchObject({ fromS: 65, toS: 85 })
  })

  it('follows the row again once a hold is let go', () => {
    const { engine, wrapper } = setup()
    const { result, rerender } = render(wrapper, { view: view(), loops: [bPart] })
    act(() => result.current.select('b'))
    act(() => result.current.hold('b', { startMs: 70_000, endMs: 90_000 }))
    act(() => result.current.hold('b', null))
    expect(engine.loopRange).toMatchObject({ fromS: 48, toS: 101 })
    rerender({ view: view(), loops: [{ ...bPart, start_ms: 60_000, end_ms: 100_000 }] })
    expect(engine.loopRange).toMatchObject({ fromS: 50, toS: 90 })
  })
})
