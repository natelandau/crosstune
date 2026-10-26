import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ZoomedWaveformView } from './practiceZoom'
import { useAutoPan } from './useAutoPan'

let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0

beforeEach(() => {
  frames = new Map()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
    frames.set(++nextFrame, fn)
    return nextFrame
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function runFrames() {
  const due = Array.from(frames.values())
  frames.clear()
  for (const frame of due) frame(0)
}

const start: ZoomedWaveformView = { startMs: 10_000, pxPerS: 20, widthPx: 300, trimStartMs: 0 }

/** A view that a pan moves at once, as the playhead clock does. */
function setup() {
  let view = start
  const onPan = vi.fn((deltaMs: number) => {
    view = { ...view, startMs: view.startMs + deltaMs }
  })
  const seen: number[] = []
  const follow = vi.fn(() => seen.push(view.startMs))
  const { result } = renderHook(() => useAutoPan({ view: () => view, onPan, follow }))
  return { result, onPan, follow, seen }
}

it('follows each pan against the view it produced', () => {
  const { result, onPan, follow, seen } = setup()
  result.current.track(start.widthPx - 2)
  expect(onPan).not.toHaveBeenCalled()
  runFrames()
  expect(onPan).toHaveBeenCalledTimes(1)
  expect(follow).toHaveBeenCalledTimes(1)
  expect(seen[0]).toBeGreaterThan(start.startMs)
})

it('keeps panning every frame the pointer stays at the edge', () => {
  const { result, onPan, seen } = setup()
  result.current.track(start.widthPx - 2)
  runFrames()
  runFrames()
  expect(onPan).toHaveBeenCalledTimes(2)
  expect(seen[1]).toBeGreaterThan(seen[0]!)
})

it('stops panning when the pointer leaves the edge or the drag ends', () => {
  const { result, onPan } = setup()
  result.current.track(start.widthPx - 2)
  runFrames()
  result.current.track(start.widthPx / 2)
  runFrames()
  expect(onPan).toHaveBeenCalledTimes(1)

  result.current.track(start.widthPx - 2)
  runFrames()
  result.current.stop()
  runFrames()
  expect(onPan).toHaveBeenCalledTimes(2)
})
