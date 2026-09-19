export const VIDEO_HEIGHT_PX = 200
export const AUDIO_HEIGHT_PX = 56
// The section's `py-1.5` above and below plus its `h-11` header.
export const CHROME_HEIGHT_PX = 6 + 44 + 6

type Loaded = { kind: 'recording' } | { kind: 'link'; height: number | 'video' }

/** Chrome plus body height for the loaded item, so the dock reserves its own room. */
export function dockHeight(item: Loaded): number {
  if (item.kind === 'recording') return CHROME_HEIGHT_PX + AUDIO_HEIGHT_PX
  return CHROME_HEIGHT_PX + (item.height === 'video' ? VIDEO_HEIGHT_PX : item.height)
}
