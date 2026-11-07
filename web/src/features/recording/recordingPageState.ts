import { SOURCES, type Source } from '../../usage/events'
import type { RecordingPageOpening } from '../player/recordingPageOpener'

/** What one open of the page carries in its history entry. */
export interface RecordingPageEntry extends Omit<RecordingPageOpening, 'tuneId'> {
  /** Names this open, so opening the page that already shows starts it afresh. */
  id?: string
  /** The address the page was opened from, which Back can return to. */
  from?: string
  /** Set once the page has reported this open and taken its tab, so Back and reload
   * onto the entry neither report it again nor reopen what it asked for. */
  reported?: boolean
}

export type RecordingPageState = { recordingPage: RecordingPageEntry }

const isSource = (value: unknown): value is Source =>
  (SOURCES as readonly unknown[]).includes(value)

/** The open a history entry carries; empty for an address reached any other way. */
export function entryOf(state: unknown): RecordingPageEntry {
  if (typeof state !== 'object' || state === null || !('recordingPage' in state)) return {}
  const entry: Partial<Record<keyof RecordingPageEntry, unknown>> =
    (state as { recordingPage: unknown }).recordingPage ?? {}
  return {
    ...(typeof entry.id === 'string' ? { id: entry.id } : {}),
    ...(typeof entry.from === 'string' ? { from: entry.from } : {}),
    ...(entry.reported === true
      ? { reported: true }
      : {
          ...(isSource(entry.source) ? { source: entry.source } : {}),
          ...(entry.tab === 'practice' ? { tab: 'practice' as const } : {}),
        }),
  }
}

/** The entry once the page has taken its open: who it is and where it came from, and no more. */
export function reportedEntry({ id, from }: RecordingPageEntry): RecordingPageState {
  return {
    recordingPage: {
      ...(id === undefined ? {} : { id }),
      ...(from === undefined ? {} : { from }),
      reported: true,
    },
  }
}
