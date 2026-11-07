import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRecordingsPlayable } from '../../billing/usePlan'
import { useDb } from '../../db/DbProvider'
import { useLatest } from '../../ui/useLatest'
import { visibleMain } from '../../platform/visibleMain'
import { usePlaybackEngine } from './PlaybackEngineProvider'
import { PagePlaybackContext, type PagePlayback } from './pagePlayback'
import { tappedFrom, type PlayOrigin } from './playLog'
import { PlayLogContext, usePlayLog } from './usePlayLog'
import {
  FROM_THE_START,
  PlayerContext,
  type Player,
  type PlayOptions,
  type PlayStart,
} from './usePlayer'
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
  const [loaded, setLoaded] = useState<{
    item: PlayerItem
    origin: PlayOrigin
    start: PlayStart
    fromPage: boolean
  } | null>(null)
  const item = loaded?.item ?? null
  const opener = useRef<HTMLElement | null>(null)

  // A loaded item belongs to one user's database. Clearing it during the render that sees a
  // new database keeps the dock from showing the previous user's recording while the new
  // read is pending.
  const db = useDb()
  const [itemDb, setItemDb] = useState(db)
  if (db !== itemDb) {
    setItemDb(db)
    setLoaded(null)
  }
  // Above every error boundary, so a failed plan read gates nothing. A plan that turns free,
  // as when a trial ends on the clock, unloads a recording in the render that sees it.
  const recordingsPlay = useRecordingsPlayable()
  const recordingsPlayRef = useLatest(recordingsPlay)
  if (!recordingsPlay && loaded?.item.kind === 'recording') setLoaded(null)

  // One entry per shown page, so a page of the same recording mounting as another unmounts, in
  // one commit, keeps the playback going.
  const [pages, setPages] = useState<readonly string[]>([])
  const onPage = item?.kind === 'recording' && pages.includes(item.id)
  // Leaving the page that started the playback stops it, so no dock shows for it.
  if (loaded?.fromPage && !onPage) setLoaded(null)
  const showPage = useCallback((recordingId: string) => {
    setPages((shown) => [...shown, recordingId])
    return () =>
      setPages((shown) => {
        const at = shown.indexOf(recordingId)
        return at < 0 ? shown : shown.toSpliced(at, 1)
      })
  }, [])
  const pagePlayback = useMemo<PagePlayback>(() => ({ onPage, showPage }), [onPage, showPage])

  const play = useCallback(
    (
      next: PlayerItem,
      { origin = DOCK_ORIGIN, at = 0, loop = null, fromPage = false }: PlayOptions = {},
    ) => {
      if (next.kind === 'recording' && !recordingsPlayRef.current) return
      const active = document.activeElement
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null
      // Synchronous, inside the tap, so iOS has already granted the AudioContext by the
      // time an audio stage needs it.
      if (next.kind === 'recording') engine.prime()
      setLoaded({ item: next, origin, start: { at, loop }, fromPage })
    },
    [engine, recordingsPlayRef],
  )
  const close = useCallback(() => setLoaded(null), [])
  const returnFocus = useCallback(() => {
    const target = opener.current?.isConnected ? opener.current : visibleMain()
    target?.focus()
  }, [])

  const start = loaded?.start ?? FROM_THE_START
  const player = useMemo<Player>(
    () => ({ item, start, play, close, returnFocus }),
    [item, start, play, close, returnFocus],
  )
  const playLog = usePlayLog(engine, item, loaded?.origin ?? DOCK_ORIGIN, { now })
  return (
    <PlayerContext.Provider value={player}>
      <PagePlaybackContext.Provider value={pagePlayback}>
        <PlayLogContext.Provider value={playLog}>{children}</PlayLogContext.Provider>
      </PagePlaybackContext.Provider>
    </PlayerContext.Provider>
  )
}
