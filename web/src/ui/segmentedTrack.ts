const TRACKS = {
  practice: 'bg-practice-hover',
  page: 'bg-field',
} as const

export type SegmentedTone = keyof typeof TRACKS

/** The capsule a row of segments sits in, on practice's background or a page's. */
export const segmentedTrack = (tone: SegmentedTone) =>
  `${TRACKS[tone]} flex rounded-(--radius-capsule) p-0.5`
