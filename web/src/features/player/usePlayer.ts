import { createContext, useContext } from 'react'
import type { PlayerItem } from '../../domain/playerItem'
import type { PlaybackLoop } from './playbackEngine'
import type { PlayOrigin } from './playLog'

export interface PlayOptions {
  /** The surface that asked, for the play log; omitted, it is the dock. */
  origin?: PlayOrigin
  /** Where a recording starts, on its trimmed timeline; omitted, its start. Applies only when
   * the call loads the recording, never to one already loaded. */
  at?: number
  /** The loop a recording starts repeating, which moves a start outside it to the loop's.
   * Applies only when the call loads the recording, never to one already loaded. */
  loop?: PlaybackLoop | null
  /** Asked by the recording's own page, which then owns the playback until another load:
   * leaving the page stops it. */
  fromPage?: boolean
}

/** Where the loaded recording starts, as `play` asked. */
export interface PlayStart {
  /** On the trimmed timeline. */
  at: number
  /** The loop to repeat, in the seconds of the recording's audio as the engine holds them. */
  loop: PlaybackLoop | null
}

export const FROM_THE_START: PlayStart = { at: 0, loop: null }

export interface Player {
  item: PlayerItem | null
  start: PlayStart
  /** Load an item with autoplay, replacing anything loaded. */
  play: (item: PlayerItem, options?: PlayOptions) => void
  /** Unload the player. */
  close: () => void
  /**
   * Focus the control that last called `play`, or the page's main region when that control
   * has left the page.
   */
  returnFocus: () => void
}

export function isPlaying(player: Pick<Player, 'item'>, item: PlayerItem): boolean {
  return player.item?.kind === item.kind && player.item.id === item.id
}

/** Where `item` starts: as `play` asked while it is the loaded item, else from its start. A
 * start asked for the next item never moves one still showing until that item is read. */
export function startOf(player: Pick<Player, 'item' | 'start'>, item: PlayerItem): PlayStart {
  return isPlaying(player, item) ? player.start : FROM_THE_START
}

// Lives outside PlayerProvider.tsx so that file exports only a component, which fast
// refresh requires.
export const PlayerContext = createContext<Player | null>(null)

export function usePlayer(): Player {
  const player = useContext(PlayerContext)
  if (!player) throw new Error('usePlayer must be used inside PlayerProvider')
  return player
}
