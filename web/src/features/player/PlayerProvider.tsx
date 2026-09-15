import { useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { DbContext } from '../../db/DbProvider'
import { PlayerContext, type Player, type PlayerItem } from './usePlayer'

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<PlayerItem | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  // A loaded item belongs to one user's database. Clearing it during the render that sees a
  // new database keeps the dock from showing the previous user's recording while the new
  // read is pending. Only the database's identity matters here, so no database is required.
  const db = useContext(DbContext)
  const [itemDb, setItemDb] = useState(db)
  if (db !== itemDb) {
    setItemDb(db)
    setItem(null)
  }

  const play = useCallback((next: PlayerItem) => {
    const active = document.activeElement
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null
    setItem(next)
  }, [])
  const close = useCallback(() => setItem(null), [])
  const returnFocus = useCallback(() => {
    const target = opener.current?.isConnected ? opener.current : document.querySelector('main')
    target?.focus()
  }, [])

  const player = useMemo<Player>(
    () => ({ item, play, close, returnFocus }),
    [item, play, close, returnFocus],
  )
  return <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>
}
