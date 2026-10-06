/** A zoomed view of a recording: `zoom` 1-2, `x` and `y` the top-left as fractions of the frame. */
export type Crop = { zoom: number; x: number; y: number }

export type CropRect = { w: number; h: number; x: number; y: number }

const floorEven = (value: number) => 2 * Math.floor(value / 2)

/**
 * The pixel rectangle of `c` in a `srcW` by `srcH` frame, with even sides so the subsampled
 * chroma planes stay aligned, the frame's aspect ratio, and clamped inside the frame. Sides
 * round down, so an odd frame side never yields a crop wider than the frame.
 */
export function cropRect(c: Crop, srcW: number, srcH: number): CropRect {
  if (!(c.zoom >= 1 && c.zoom <= 2)) throw new Error(`crop zoom ${c.zoom} is outside 1-2`)
  const w = floorEven(srcW / c.zoom)
  const h = floorEven(srcH / c.zoom)
  return {
    w,
    h,
    x: floorEven(Math.min(Math.max(0, c.x * srcW), srcW - w)),
    y: floorEven(Math.min(Math.max(0, c.y * srcH), srcH - h)),
  }
}

/** A point in screen points, as coordinates in the cropped frame, or null when it falls outside. */
export function mapPoint(
  p: { x: number; y: number },
  rect: CropRect,
  scale: number,
): { x: number; y: number } | null {
  const x = p.x * scale - rect.x
  const y = p.y * scale - rect.y
  return x < 0 || y < 0 || x >= rect.w || y >= rect.h ? null : { x, y }
}
