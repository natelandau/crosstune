import { createContext, useContext } from 'react'
import type { PlayerItem } from '../../domain/playerItem'
import type { PlayOrigin } from './playLog'

export interface Player {
  item: PlayerItem | null
  /** Load an item with autoplay, replacing anything loaded. `origin` names the surface that
   * asked, for the play log; omitted, it is the dock. */
  play: (item: PlayerItem, origin?: PlayOrigin) => void
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

// Lives outside PlayerProvider.tsx so that file exports only a component, which fast
// refresh requires.
export const PlayerContext = createContext<Player | null>(null)

export function usePlayer(): Player {
  const player = useContext(PlayerContext)
  if (!player) throw new Error('usePlayer must be used inside PlayerProvider')
  return player
}
