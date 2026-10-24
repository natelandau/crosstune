export const RAIL_WIDTH = 236
export const MIN_CONTENT_WIDTH = 420
/**
 * The rail's first group header's top padding, which centers it on the first section heading:
 * the content column's top padding plus half of what the heading's height has over the
 * header's line.
 */
export const RAIL_TOP = 'calc(1rem + (2.75rem - 1lh) / 2)'

/** The rail needs room beside a readable column; below that the facts fold into a card. */
export function factsLayout(detailWidth: number): 'rail' | 'card' {
  return detailWidth >= RAIL_WIDTH + MIN_CONTENT_WIDTH ? 'rail' : 'card'
}

/** Classes that set a tune page's band in line with the column under it. */
export function bandGutter(layout: 'rail' | 'card'): string {
  return layout === 'rail' ? 'px-7' : 'max-w-page mx-auto w-full px-4'
}
