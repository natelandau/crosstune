import { createContext, useContext } from 'react'
import type { RepeatMode } from './listQueue'

/** Per device, so a choice outlives the queue, which is never stored. */
export const SHUFFLE_KEY = 'crosstune.listPlayback.shuffle'
export const REPEAT_KEY = 'crosstune.listPlayback.repeat'

/** A move on through the queue (next, a natural end, a jump, a pass over) or back. */
export type ListStep = 'forward' | 'back'

/** The list that plays and where in it. */
export interface ListPlaybackActive {
  listId: string
  listName: string
  position: number
  count: number
  shuffled: boolean
  repeat: RepeatMode
  /** Why playback stopped, kept with the player closed until `end`. */
  message: string | null
}

export interface ListPlayback {
  active: ListPlaybackActive | null
  /** Closes the player and plays the list's playable tunes as a queue. Omitting `shuffle`
   * keeps this device's last choice. */
  start: (listId: string, options?: { shuffle?: boolean }) => Promise<void>
  /** Plays a queued tune now; false when the queue lacks it, so the caller plays it alone. */
  jump: (tuneId: string) => boolean
  next: () => void
  previous: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  /** Stops the list, closing the player if it holds the list's tune, and clears `message`. */
  end: () => void
}

/** Told when the player cannot get a recording's audio, so a playing list passes over it.
 * Outside a playing list it does nothing. */
export const LoadFailedContext = createContext<(recordingId: string) => void>(() => {})

/** Told which recording practice holds, or null: one open in trim, or under a
 * sheet editing it. A playing list holds at that recording's natural end, so work under way on
 * it never moves on to another recording. Outside a playing list it does nothing. */
export const ListHoldContext = createContext<(recordingId: string | null) => void>(() => {})

// Lives outside the provider's file so that file exports only a component, which fast
// refresh requires.
export const ListPlaybackContext = createContext<ListPlayback | null>(null)

export function useListPlayback(): ListPlayback {
  const playback = useContext(ListPlaybackContext)
  if (!playback) throw new Error('useListPlayback must be used inside ListPlaybackProvider')
  return playback
}
