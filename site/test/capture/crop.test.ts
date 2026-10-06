import { describe, expect, it } from 'vitest'
import { cropRect, mapPoint } from '../../capture/crop.ts'

describe('cropRect', () => {
  it('crops to the frame aspect with even sides', () => {
    const rect = cropRect({ zoom: 1.5, x: 0, y: 0.2 }, 1206, 2622)
    expect(rect).toEqual({ w: 804, h: 1748, x: 0, y: 524 })
    expect(Math.abs(rect.w / rect.h - 1206 / 2622) * rect.h).toBeLessThan(1)
  })

  it('clamps a crop that runs past the frame', () => {
    expect(cropRect({ zoom: 1.6, x: 0.9, y: 0.9 }, 1206, 2622)).toEqual({
      w: 752,
      h: 1638,
      x: 454,
      y: 984,
    })
  })

  it('never offsets past the top left of a frame with odd sides', () => {
    expect(cropRect({ zoom: 1, x: 0.5, y: 0.5 }, 1179, 2555)).toEqual({
      w: 1178,
      h: 2554,
      x: 0,
      y: 0,
    })
  })

  it('throws for a zoom outside 1-2', () => {
    expect(() => cropRect({ zoom: 2.5, x: 0, y: 0 }, 1206, 2622)).toThrow()
    expect(() => cropRect({ zoom: 0.9, x: 0, y: 0 }, 1206, 2622)).toThrow()
  })
})

describe('mapPoint', () => {
  const rect = { w: 804, h: 1748, x: 100, y: 524 }

  it('offsets a point inside the crop', () => {
    expect(mapPoint({ x: 100, y: 300 }, rect, 3)).toEqual({ x: 200, y: 376 })
  })

  it('returns null outside the crop', () => {
    expect(mapPoint({ x: 10, y: 300 }, rect, 3)).toBeNull()
    expect(mapPoint({ x: 100, y: 10 }, rect, 3)).toBeNull()
    expect(mapPoint({ x: 100, y: 900 }, rect, 3)).toBeNull()
  })
})
