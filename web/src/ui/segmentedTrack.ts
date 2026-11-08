/** The capsule a row of segments sits in. */
export const SEGMENTED_TRACK = 'bg-field flex rounded-(--radius-capsule) p-0.5'

/** A segment's text: secondary until chosen. */
export const SEGMENT_TEXT = 'text-secondary hover:text-primary data-[selected]:text-primary'

/** The chosen segment's pill, drawn on its own when it slides between segments. */
export const SEGMENT_PILL = 'bg-page'

/** A segment whose chosen state draws its own pill. */
export const SEGMENT = `${SEGMENT_TEXT} data-[selected]:bg-page`
