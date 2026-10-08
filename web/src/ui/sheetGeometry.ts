/** How dark the backdrop behind every sheet, dialog, and alert gets when it shows fully. */
export const SCRIM_OPACITY = 0.4

/** The backdrop color at `shown`, 0 hidden to 1 fully shown. */
export function scrim(shown: number): string {
  return `rgba(0, 0, 0, ${SCRIM_OPACITY * shown})`
}

/** Touch sheet geometry, in px of the viewport, and the release rule's flick speed. */
export const SHEET = {
  /** The gap above a full-height sheet. */
  topMargin: 34,
  /** How much of the viewport a part-height sheet shows. */
  partRatio: 0.5,
  /** px/s; a release at least this fast moves one detent in its direction. */
  flick: 500,
  /** How far below the bounding detent a locked sheet stretches, as Motion's elastic. */
  lockedElastic: 0.15,
  /** The pointer dialog's width, capped at the viewport minus the gutter on each side. */
  width: 480,
  gutter: 16,
  /** ms a parent has to close a sheet after a closing release before it goes back up. */
  closeAnswerMs: 150,
} as const

/**
 * Where a released sheet settles, as an offset from full. A flick moves one detent in its
 * direction from where the finger let go; a slower release goes to the nearest detent.
 */
export function releaseTarget(at: number, velocity: number, detents: readonly number[]): number {
  const sorted = [...detents].sort((a, b) => a - b)
  if (velocity >= SHEET.flick) return sorted.find((d) => d > at) ?? sorted.at(-1)!
  if (velocity <= -SHEET.flick) return sorted.findLast((d) => d < at) ?? sorted[0]!
  return sorted.reduce((best, d) => (Math.abs(d - at) < Math.abs(best - at) ? d : best))
}

/** The box of the control a surface grows out of, or null when it is missing or hidden. */
export function originBox(origin: (() => Element | null) | undefined): DOMRect | null {
  const box = origin?.()?.getBoundingClientRect()
  return box && box.width > 0 && box.height > 0 ? box : null
}

/** The scale a surface `width` wide starts from to look as wide as `box`. */
export function growScale(box: DOMRect, width: number, ceiling = 1): number {
  return Math.min(Math.max(box.width / width, 0.1), ceiling)
}
