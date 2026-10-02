import { describe, expect, it } from 'vitest'
import {
  clampZoom,
  fitSpan,
  MAX_PX_PER_S,
  minPxPerS,
  openingZoom,
  pageToKeep,
  panBy,
  visibleSpan,
  zoomBy,
} from './practiceZoom'

const frame = { widthPx: 300, lengthMs: 180_000 }

describe('practiceZoom', () => {
  it('stops zooming out where the whole recording fits and in at 4 px per 20 ms peak', () => {
    expect(minPxPerS(300, 180_000)).toBeCloseTo(300 / 180)
    expect(MAX_PX_PER_S).toBe(200)
    const out = zoomBy({ pxPerS: 10, centerMs: 90_000 }, 1 / 100, 90_000, frame)
    expect(out.pxPerS).toBeCloseTo(300 / 180)
    expect(visibleSpan(out, 300)).toEqual({ startMs: 0, endMs: 180_000 })
    const deep = zoomBy({ pxPerS: 150, centerMs: 90_000 }, 10, 90_000, frame)
    expect(deep.pxPerS).toBe(MAX_PX_PER_S)
  })

  it('keeps the anchor where it is on screen while zooming', () => {
    const before = { pxPerS: 10, centerMs: 60_000 }
    const anchorMs = 66_000
    const after = zoomBy(before, 2, anchorMs, frame)
    const at = (state: typeof before) =>
      ((anchorMs - visibleSpan(state, 300).startMs) / 1000) * state.pxPerS
    expect(after.pxPerS).toBe(20)
    expect(at(after)).toBeCloseTo(at(before))
  })

  it('fits a span with a tenth of its length as margin on each side', () => {
    const fitted = fitSpan({ startMs: 58_000, endMs: 111_000 }, 300)
    const shown = visibleSpan(fitted, 300)
    expect(shown.startMs).toBeCloseTo(52_700)
    expect(shown.endMs).toBeCloseTo(116_300)
    expect(fitted.centerMs).toBe(84_500)
  })

  it('keeps the scale and the center through a change of width, as on rotation', () => {
    const portrait = clampZoom({ pxPerS: 12, centerMs: 70_000 }, frame)
    const landscape = clampZoom(portrait, { ...frame, widthPx: 700 })
    expect(landscape).toEqual(portrait)
    const wide = visibleSpan(landscape, 700)
    expect(wide.endMs - wide.startMs).toBeGreaterThan(
      visibleSpan(portrait, 300).endMs - visibleSpan(portrait, 300).startMs,
    )
    expect((wide.startMs + wide.endMs) / 2).toBe(70_000)
  })

  it('holds the view inside the recording', () => {
    expect(visibleSpan(clampZoom({ pxPerS: 10, centerMs: 1000 }, frame), 300).startMs).toBe(0)
    expect(visibleSpan(clampZoom({ pxPerS: 10, centerMs: 179_000 }, frame), 300).endMs).toBe(
      180_000,
    )
    expect(visibleSpan(panBy({ pxPerS: 10, centerMs: 20_000 }, -50_000, frame), 300).startMs).toBe(
      0,
    )
    // A pan the ends refuse keeps the state itself, so it renders nothing.
    const atStart = { pxPerS: 10, centerMs: 15_000 }
    expect(panBy(atStart, -1_000, frame)).toBe(atStart)
  })

  it('pages only once the playhead leaves the view', () => {
    const state = { pxPerS: 10, centerMs: 15_000 }
    expect(pageToKeep(state, 20_000, 300)).toBe(state)
    expect(pageToKeep(state, 29_900, 300)).toBe(state)
    const paged = pageToKeep(state, 30_100, 300)
    expect(visibleSpan(paged, 300).startMs).toBe(30_100)
    const back = pageToKeep(paged, 2_000, 300)
    expect(visibleSpan(back, 300).startMs).toBe(2_000)
  })

  it('opens 30 seconds around the playhead', () => {
    const opened = openingZoom(null, 60_000, frame)
    expect(visibleSpan(opened, 300)).toEqual({ startMs: 45_000, endMs: 75_000 })
    expect(visibleSpan(openingZoom(null, 0, frame), 300)).toEqual({ startMs: 0, endMs: 30_000 })
  })

  it('opens fitted to a loop when there is one', () => {
    const opened = openingZoom({ startMs: 58_000, endMs: 111_000 }, 0, frame)
    expect(opened).toEqual(fitSpan({ startMs: 58_000, endMs: 111_000 }, 300))
  })
})
