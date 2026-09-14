import { useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { DbContext } from '../../db/DbProvider'
import { PlayerContext, type Player } from './usePlayer'

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [linkId, setLinkId] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  // A loaded link belongs to one user's database. Clearing it during the render that sees a
  // new database keeps the dock from showing the previous user's recording while the new
  // read is pending. Only the database's identity matters here, so no database is required.
  const db = useContext(DbContext)
  const [linkDb, setLinkDb] = useState(db)
  if (db !== linkDb) {
    setLinkDb(db)
    setLinkId(null)
  }

  const play = useCallback((next: string) => {
    const active = document.activeElement
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null
    setLinkId(next)
  }, [])
  const close = useCallback(() => setLinkId(null), [])
  const returnFocus = useCallback(() => {
    const target = opener.current?.isConnected ? opener.current : document.querySelector('main')
    target?.focus()
  }, [])

  const player = useMemo<Player>(
    () => ({ linkId, play, close, returnFocus }),
    [linkId, play, close, returnFocus],
  )
  return <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>
}
