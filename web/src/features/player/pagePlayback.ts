import { createContext, useContext, useLayoutEffect } from 'react'

/**
 * Which recordings' pages show, so a page can be the player for its own recording. Playback a
 * page started belongs to that page and stops once no page shows the recording; while a page
 * shows the loaded recording, whoever started it, the page's controls are its only player.
 */
export interface PagePlayback {
  /** A page shows the loaded recording, so the dock and the phone bar stay hidden. */
  onPage: boolean
  /** Marks a page of `recordingId` as showing, until the returned call. */
  showPage: (recordingId: string) => () => void
}

// Outside PlayerProvider, as with a test's fake player, no page is ever the player.
export const PagePlaybackContext = createContext<PagePlayback>({
  onPage: false,
  showPage: () => () => {},
})

export function usePagePlayback(): PagePlayback {
  return useContext(PagePlaybackContext)
}

/** Marks the caller as a page of `recordingId` while it is mounted. */
export function useShowsRecordingPage(recordingId: string): void {
  const { showPage } = usePagePlayback()
  // Before paint, so the dock never shows for a frame over the page of what it plays.
  useLayoutEffect(() => showPage(recordingId), [showPage, recordingId])
}
