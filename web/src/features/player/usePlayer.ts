import { createContext, useContext } from 'react'

export interface Player {
  linkId: string | null
  /** Load a link with autoplay, replacing anything loaded. */
  play: (linkId: string) => void
  /** Unload the player. */
  close: () => void
  /**
   * Focus the control that last called `play`, or the page's main region when that control
   * has left the page.
   */
  returnFocus: () => void
}

// Lives outside PlayerProvider.tsx so that file exports only a component, which fast
// refresh requires.
export const PlayerContext = createContext<Player | null>(null)

export function usePlayer(): Player {
  const player = useContext(PlayerContext)
  if (!player) throw new Error('usePlayer must be used inside PlayerProvider')
  return player
}
