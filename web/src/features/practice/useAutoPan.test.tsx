import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LaneView } from './practiceZoom'
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

const start: LaneView = { startMs: 10_000, pxPerS: 20, widthPx: 300, trimStartMs: 0 }

it('follows a pan against the view it produced, not the one before it', () => {
  const onPan = vi.fn()
  const follow = vi.fn()
  const { result, rerender } = renderHook(({ view }) => useAutoPan({ view, onPan, follow }), {
    initialProps: { view: start },
  })
  result.current.track(start.widthPx - 2)
  runFrames()
  expect(onPan).toHaveBeenCalledTimes(1)
  // The pan has not reached the view yet, so there is nothing new to follow.
  expect(follow).not.toHaveBeenCalled()

  rerender({ view: { ...start, startMs: start.startMs + 400 } })
  expect(follow).toHaveBeenCalledTimes(1)
})

it('keeps panning while the pan it asked for has yet to render', () => {
  const onPan = vi.fn()
  const follow = vi.fn()
  const { result, rerender } = renderHook(({ view }) => useAutoPan({ view, onPan, follow }), {
    initialProps: { view: start },
  })
  result.current.track(start.widthPx - 2)
  runFrames()
  runFrames()
  expect(onPan).toHaveBeenCalledTimes(2)

  rerender({ view: { ...start, startMs: start.startMs + 800 } })
  expect(follow).toHaveBeenCalledTimes(1)
})

it('stops panning when the pointer leaves the edge or the drag ends', () => {
  const onPan = vi.fn()
  const follow = vi.fn()
  const { result, rerender } = renderHook(({ view }) => useAutoPan({ view, onPan, follow }), {
    initialProps: { view: start },
  })
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
  rerender({ view: { ...start, pxPerS: start.pxPerS * 2 } })
  expect(follow).not.toHaveBeenCalled()
})
