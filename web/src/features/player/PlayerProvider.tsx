import { useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { DbContext } from '../../db/DbProvider'
import { visibleMain } from '../../platform/visibleMain'
import { usePlaybackEngine } from './PlaybackEngineProvider'
import { tappedFrom, type PlayOrigin } from './playLog'
import { PlayLogContext, usePlayLog } from './usePlayLog'
import { PlayerContext, type Player } from './usePlayer'
import type { PlayerItem } from '../../domain/playerItem'

const DOCK_ORIGIN: PlayOrigin = { context: 'dock', report: tappedFrom('dock') }

export function PlayerProvider({
  children,
  now,
}: {
  children: ReactNode
  /** The play log's clock; tests pass one they move on. */
  now?: () => number
}) {
  const engine = usePlaybackEngine()
  const [loaded, setLoaded] = useState<{ item: PlayerItem; origin: PlayOrigin } | null>(null)
  const item = loaded?.item ?? null
  const opener = useRef<HTMLElement | null>(null)

  // A loaded item belongs to one user's database. Clearing it during the render that sees a
  // new database keeps the dock from showing the previous user's recording while the new
  // read is pending. Only the database's identity matters here, so no database is required.
  const db = useContext(DbContext)
  const [itemDb, setItemDb] = useState(db)
  if (db !== itemDb) {
    setItemDb(db)
    setLoaded(null)
  }

  const play = useCallback(
    (next: PlayerItem, origin: PlayOrigin = DOCK_ORIGIN) => {
      const active = document.activeElement
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null
      // Synchronous, inside the tap, so iOS has already granted the AudioContext by the
      // time a pitch stage needs it.
      if (next.kind === 'recording') engine.prime()
      setLoaded({ item: next, origin })
    },
    [engine],
  )
  const close = useCallback(() => setLoaded(null), [])
  const returnFocus = useCallback(() => {
    const target = opener.current?.isConnected ? opener.current : visibleMain()
    target?.focus()
  }, [])

  const player = useMemo<Player>(
    () => ({ item, play, close, returnFocus }),
    [item, play, close, returnFocus],
  )
  const playLog = usePlayLog(engine, item, loaded?.origin ?? DOCK_ORIGIN, { now })
  return (
    <PlayerContext.Provider value={player}>
      <PlayLogContext.Provider value={playLog}>{children}</PlayLogContext.Provider>
    </PlayerContext.Provider>
  )
}
