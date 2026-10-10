import { act, renderHook } from '@testing-library/react'
import { MotionConfig, MotionGlobalConfig } from 'motion/react'
import type { ReactNode } from 'react'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { fakePlaybackEngine } from '../../test/providers'
import { recordingFile, recordingRow } from '../../test/rows'
import { ZOOM_STEP } from './panel'
import type { RecordingView } from '../recordings/useRecordings'
import { MAX_PX_PER_S, OPENING_SPAN_MS } from './practiceZoom'
import { usePracticeTimeline } from './usePracticeTimeline'

const LENGTH_MS = 180_000
const WIDTH_PX = 400

function setup({ reduceMotion = false }: { reduceMotion?: boolean } = {}) {
  const view: RecordingView = {
    recording: recordingRow('rec-1', { trim_start_ms: 10_000, source_duration_ms: 190_000 }),
    file: recordingFile('rec-1'),
    tuneId: null,
    tuneTitle: null,
  }
  const engine = fakePlaybackEngine()
  engine.load(
    'blob:a',
    { fromS: 10, toS: 190, lengthMs: LENGTH_MS },
    { speedPercent: 100, pitchCents: 0 },
    { title: 'Jam' },
  )
  const rendered = renderHook(
    ({ width }: { width: number }) => {
      const timeline = usePracticeTimeline({ view, engine, size: { width } })
      // Practice's loops open the view once they are read; here there are none.
      timeline.open(null)
      return timeline
    },
    {
      initialProps: { width: WIDTH_PX },
      wrapper: ({ children }: { children: ReactNode }) => (
        <MotionConfig reducedMotion={reduceMotion ? 'always' : 'never'}>{children}</MotionConfig>
      ),
    },
  )
  return { engine, ...rendered }
}

describe('usePracticeTimeline', () => {
  it('opens on 30 seconds around the playhead', () => {
    const { result } = setup()
    expect(result.current.pxPerS).toBe(WIDTH_PX / (OPENING_SPAN_MS / 1000))
    expect(result.current.bounds).toEqual({ startMs: 10_000, endMs: 190_000 })
  })

  it('zooms in no further than the maximum scale', () => {
    const { result } = setup()
    for (let i = 0; i < 20; i++) act(() => result.current.zoom(ZOOM_STEP))
    expect(result.current.pxPerS).toBe(MAX_PX_PER_S)
    expect(result.current.scale).toBe(MAX_PX_PER_S)
    expect(result.current.canZoomIn).toBe(false)
    expect(result.current.canZoomOut).toBe(true)
  })

  it('zooms out no further than the whole take', () => {
    const { result } = setup()
    for (let i = 0; i < 20; i++) act(() => result.current.zoom(1 / ZOOM_STEP))
    expect(result.current.pxPerS).toBe(WIDTH_PX / (LENGTH_MS / 1000))
    expect(result.current.canZoomOut).toBe(false)
    expect(result.current.canZoomIn).toBe(true)
  })

  it('Fit with no loop shows the whole take', () => {
    const { result } = setup()
    act(() => result.current.fit(null))
    expect(result.current.pxPerS).toBe(result.current.minScale)
  })

  it('Fit seeks a playhead outside the loop to its start on the trimmed timeline', () => {
    const { engine, result } = setup()
    const seek = vi.spyOn(engine, 'seek')
    act(() => result.current.fit({ startMs: 58_000, endMs: 111_000 }))
    expect(seek).toHaveBeenCalledWith(48_000)
  })

  it('a set scale holds when the frame changes, and the opening one follows it', () => {
    const { result, rerender } = setup()
    rerender({ width: 300 })
    expect(result.current.pxPerS).toBe(300 / (OPENING_SPAN_MS / 1000))
    act(() => result.current.zoom(ZOOM_STEP))
    const set = result.current.pxPerS
    rerender({ width: 350 })
    expect(result.current.pxPerS).toBe(set)
  })

  it('holds the playhead it reports to the take while a scrub pulls past either end', () => {
    const { result } = setup()
    act(() => result.current.onScrubbing(-500))
    expect(result.current.shownMs).toBe(0)
    expect(result.current.playheadMs).toBe(10_000)
    expect(result.current.visible!.startMs + result.current.visible!.endMs).toBeCloseTo(0, 6)
    act(() => result.current.onScrubbing(LENGTH_MS + 500))
    expect(result.current.shownMs).toBe(LENGTH_MS)
    expect(result.current.playheadMs).toBe(10_000 + LENGTH_MS)
  })

  it('skips from where the playhead shows', () => {
    const { engine, result } = setup()
    const seek = vi.spyOn(engine, 'seek')
    act(() => result.current.skip(15_000))
    expect(seek).toHaveBeenCalledWith(15_000)
  })
})

describe('a pinch past a zoom limit', () => {
  const minScale = WIDTH_PX / (LENGTH_MS / 1000)

  it('stretches the drawn scale past the maximum, then springs back to it', async () => {
    MotionGlobalConfig.instantAnimations = true
    onTestFinished(() => {
      MotionGlobalConfig.instantAnimations = false
    })
    const { result } = setup()
    act(() => result.current.pinchZoom(MAX_PX_PER_S / result.current.pxPerS!))
    expect(result.current.pxPerS).toBeCloseTo(MAX_PX_PER_S, 6)
    act(() => result.current.pinchZoom(1.5))
    expect(result.current.scale).toBe(MAX_PX_PER_S)
    expect(result.current.pxPerS).toBeGreaterThan(MAX_PX_PER_S)
    expect(result.current.pxPerS).toBeLessThan(MAX_PX_PER_S * 1.25)
    act(() => result.current.endPinch())
    await expect.poll(() => result.current.pxPerS).toBe(MAX_PX_PER_S)
  })

  it('stretches below the whole take, then springs back to it', async () => {
    MotionGlobalConfig.instantAnimations = true
    onTestFinished(() => {
      MotionGlobalConfig.instantAnimations = false
    })
    const { result } = setup()
    act(() => result.current.pinchZoom(minScale / result.current.pxPerS!))
    act(() => result.current.pinchZoom(1 / 1.5))
    expect(result.current.pxPerS).toBeLessThan(minScale)
    expect(result.current.pxPerS).toBeGreaterThan(minScale / 1.25)
    act(() => result.current.endPinch())
    await expect.poll(() => result.current.pxPerS).toBeCloseTo(minScale, 6)
  })

  it('springs back from the latest stretch when the fingers lift before it renders', async () => {
    MotionGlobalConfig.instantAnimations = true
    onTestFinished(() => {
      MotionGlobalConfig.instantAnimations = false
    })
    const { result } = setup()
    act(() => {
      result.current.pinchZoom((MAX_PX_PER_S / result.current.pxPerS!) * 1.5)
      result.current.endPinch()
    })
    await expect.poll(() => result.current.pxPerS).toBe(MAX_PX_PER_S)
  })

  it('settles from the latest stretch under reduced motion when the lift comes first', () => {
    const { result } = setup({ reduceMotion: true })
    act(() => {
      result.current.pinchZoom((MAX_PX_PER_S / result.current.pxPerS!) * 1.5)
      result.current.endPinch()
    })
    expect(result.current.pxPerS).toBe(MAX_PX_PER_S)
  })

  it('settles at the limit at once under reduced motion', () => {
    const { result } = setup({ reduceMotion: true })
    act(() => result.current.pinchZoom((MAX_PX_PER_S / result.current.pxPerS!) * 1.5))
    expect(result.current.pxPerS).toBeGreaterThan(MAX_PX_PER_S)
    act(() => result.current.endPinch())
    expect(result.current.pxPerS).toBe(MAX_PX_PER_S)
  })
})
