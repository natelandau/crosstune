export const COLUMN_WIDTH = 236
export const MIN_CONTENT_WIDTH = 420
/**
 * The attributes column's first group header's top padding, which centers it on the first
 * section heading: the content column's top padding plus half of what the heading's height has
 * over the header's line.
 */
export const COLUMN_TOP = 'calc(1rem + (2.75rem - 1lh) / 2)'

/**
 * The attributes column needs room beside a readable content column; below that the attributes
 * fold into a card.
 */
export function attributesLayout(detailWidth: number): 'column' | 'card' {
  return detailWidth >= COLUMN_WIDTH + MIN_CONTENT_WIDTH ? 'column' : 'card'
}

/** Classes that set a tune page's header in line with the column under it. */
export function headerGutter(layout: 'column' | 'card'): string {
  return layout === 'column' ? 'px-7' : 'max-w-page mx-auto w-full px-4'
}
