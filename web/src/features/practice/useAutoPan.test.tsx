import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LaneView } from './practiceZoom'
import { useAutoPan } from './useAutoPan'

let frames: FrameRequestCallback[] = []

beforeEach(() => {
  frames = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => frames.push(fn))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function runFrames() {
  const due = frames.splice(0)
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

it('does not follow a later view change after the ends refused a pan', () => {
  const onPan = vi.fn()
  const follow = vi.fn()
  const { result, rerender } = renderHook(({ view }) => useAutoPan({ view, onPan, follow }), {
    initialProps: { view: start },
  })
  result.current.track(start.widthPx - 2)
  runFrames()
  expect(onPan).toHaveBeenCalledTimes(1)
  // The view did not move, and the next frame passes.
  runFrames()

  rerender({ view: { ...start, pxPerS: start.pxPerS * 2 } })
  expect(follow).not.toHaveBeenCalled()
})
