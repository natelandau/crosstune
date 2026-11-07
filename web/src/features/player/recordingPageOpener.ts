import { createContext, useContext } from 'react'
import type { Source } from '../../usage/events'

export interface RecordingPageOpening {
  /** The tab the page shows at compact widths; omitted, the tab last used on this device. */
  tab?: 'practice'
  /** Where the page opened from, for `recording_page_opened`; omitted, the parent tells. */
  source?: Source
  /** The recording's tune, so the page opens under that tune where the tab shows it. */
  tuneId: string | null
}

/** Opens a recording's page, leaving playback as it is. */
export type OpenRecordingPage = (recordingId: string, opening: RecordingPageOpening) => void

/**
 * What the dock's Expand, the now-playing bar, and the tune's Practice call. Null outside the
 * router, which leaves the bar's body inert and Expand disabled.
 */
export const RecordingPageOpenerContext = createContext<OpenRecordingPage | null>(null)

export function useOpenRecordingPage(): OpenRecordingPage | null {
  return useContext(RecordingPageOpenerContext)
}
