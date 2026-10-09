import { useLiveQuery } from 'dexie-react-hooks'
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { Trigger } from '../../usage/events'
import { createPlaybackReporter } from '../../usage/playbackReporter'
import { useDb } from '../../db/DbProvider'
import type { CrosstuneDb } from '../../db/schema'
import { useOnline } from '../../sync/SyncProvider'
import { useLatest } from '../../ui/useLatest'
import {
  createQueue,
  cycleRepeat as nextRepeat,
  jump as jumpTo,
  next as nextInQueue,
  previous as previousInQueue,
  setShuffled,
  type Queue,
  type RepeatMode,
} from './listQueue'
import { playlistReport, playlistSource } from './listSource'
import { usePlaybackEngine } from './PlaybackEngineProvider'
import { NOTHING_LEFT } from './playerCopy'
import { playlistAvailability, readPlaylist, type Playlist } from './readPlaylist'
import {
  ListPlaybackContext,
  ListHoldContext,
  LoadFailedContext,
  REPEAT_KEY,
  SHUFFLE_KEY,
  type ListPlayback,
  type ListPlaybackActive,
  type ListStep,
} from './useListPlayback'
import { usePlayer } from './usePlayer'
import { readStored, writeStored } from '../../platform/storage'
import type { PlayerItem } from '../../domain/playerItem'
import { usePlayLogControl } from './usePlayLog'
import type { PlayAttribution } from './playLog'

interface Run {
  db: CrosstuneDb
  listId: string
  listName: string
  queue: Queue
  message: string | null
}

const REPEAT_MODES: readonly RepeatMode[] = ['off', 'list', 'one']

function createRunStore() {
  let run: Run | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => run,
    set: (next: Run | null) => {
      run = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

function storedRepeat(): RepeatMode {
  const raw = readStored(REPEAT_KEY)
  return REPEAT_MODES.find((mode) => mode === raw) ?? 'off'
}

/**
 * Plays a list as a queue through the one player. Each tune's recording is chosen when its
 * turn comes, from what the list shows then, so a tune deleted, removed, or hidden meanwhile
 * is passed over and still counts toward the position. Anything else loading into the player,
 * or the player closing, detaches the queue. Mount it inside `PlayerProvider`.
 */
export function ListPlaybackProvider({
  children,
  random = Math.random,
  read = readPlaylist,
}: {
  children: ReactNode
  /** Draws for the shuffle; tests pass a seeded one. */
  random?: () => number
  /** Reads what a list can play; tests hold it to reach a turn mid-read. */
  read?: (db: CrosstuneDb, listId: string) => Promise<Playlist | null>
}) {
  const db = useDb()
  const engine = usePlaybackEngine()
  const analytics = useAnalytics()
  const player = usePlayer()
  const playerRef = useLatest(player)
  const onlineRef = useLatest(useOnline())
  const dbRef = useLatest(db)

  const [repeat, setRepeat] = useState(storedRepeat)
  const repeatRef = useLatest(repeat)
  const shuffleRef = useRef<boolean | null>(null)
  const preferShuffle = () => (shuffleRef.current ??= readStored(SHUFFLE_KEY) === 'true')
  const chooseShuffle = (on: boolean) => {
    shuffleRef.current = on
    writeStored(SHUFFLE_KEY, String(on))
  }

  // A store rather than state, since async turns and effects read and write it between
  // renders. Its queue is where the list is headed, set the moment a move is asked for, so a
  // second move or a shuffle during a pending turn builds on the first.
  const [runs] = useState(createRunStore)
  const run = useSyncExternalStore(runs.subscribe, runs.get)
  const commit = runs.set
  // The item the queue last handed the player. Identity, not id, tells the queue's load from
  // another surface playing the same recording.
  const ownItem = useRef<PlayerItem | null>(null)
  // The engine's load count when `ownItem` was handed over: a failure counts against the item
  // only once the engine has loaded since.
  const handedAt = useRef(0)
  // The item a failure was last counted against, so one item counts once.
  const counted = useRef<PlayerItem | null>(null)
  // The tune `ownItem` plays, to return to when a step back finds nothing.
  const loadedTune = useRef<string | null>(null)
  // Tunes passed over or failed since one last played, and how many of those failed to load.
  const misses = useRef(0)
  const failures = useRef(0)
  // Bumped by every move, so a turn still reading the database gives way to a later one.
  const generation = useRef(0)
  const pendingTurn = useRef<number | null>(null)
  // A start is reading its list; anything played meanwhile cancels it. The list playing
  // until then plays on, so its own turns never cancel a start.
  const starting = useRef(false)
  const startTurn = useRef(0)
  // The recording practice holds, whose natural end the list holds at.
  const holding = useRef<string | null>(null)
  // What moved the queue last, which a tune passed over hands on to the one that plays.
  const trigger = useRef<Trigger>('tap')
  // A start not yet reported, sent once its first tune loads.
  const unreportedStart = useRef<{
    shuffle: boolean
    repeat: RepeatMode
    count: number
    listId: string
  } | null>(null)
  // A playlist's start reads no rows.
  const reporter = useMemo(() => createPlaybackReporter(analytics, null), [analytics])

  const holdsOwn = () => ownItem.current !== null && playerRef.current.item === ownItem.current
  /** The run while its own item is in the player and no turn is pending. */
  const settled = () => {
    const current = runs.get()
    return current?.message === null && pendingTurn.current === null && holdsOwn() ? current : null
  }

  const detach = () => {
    generation.current += 1
    pendingTurn.current = null
    unreportedStart.current = null
    ownItem.current = null
    loadedTune.current = null
    commit(null)
  }

  const resolve = (playlist: Playlist | null, tuneId: string | null): PlayerItem | null => {
    const entry = playlist?.entries.find((e) => e.tuneId === tuneId)
    if (!playlist || !entry) return null
    const choice = playlistSource({
      ...entry,
      ...playlistAvailability(playlist, onlineRef.current),
    })
    return 'item' in choice ? choice.item : null
  }

  const load = (item: PlayerItem, current: Run) => {
    loadedTune.current = current.queue.current
    if (holdsOwn() && ownItem.current?.id === item.id && ownItem.current.kind === item.kind) {
      // The player keeps a recording it already holds loaded, so replaying it is a restart.
      engine.seek(0)
      engine.play()
      return
    }
    ownItem.current = item
    handedAt.current = engine.loads
    counted.current = null
    playerRef.current.play(item, {
      context: 'list',
      listId: current.listId,
      report: { source: 'list', queue: 'playlist', trigger: trigger.current },
    })
    const start = unreportedStart.current
    if (start) {
      unreportedStart.current = null
      reporter.playlistStarted(start)
    }
  }

  const giveUp = (current: Run, queue: Queue) => {
    generation.current += 1
    pendingTurn.current = null
    ownItem.current = null
    commit({ ...current, queue, message: NOTHING_LEFT })
    playerRef.current.close()
  }

  /** Off the end with repeat off. Only tunes passed over since the last one played end the
   * list as its last tune ending would; a failure, or nothing played yet, has nothing left. */
  const runOut = (current: Run, queue: Queue) => {
    if (failures.current > 0 || !holdsOwn()) return giveUp(current, queue)
    engine.pause()
    detach()
  }

  /** Heads for `queue` and plays the tune it stands on, as `moved` started it. */
  const move = (current: Run, queue: Queue, direction: ListStep, moved: Trigger) => {
    trigger.current = moved
    commit({ ...current, queue })
    void settle(direction)
  }

  /**
   * Plays the tune the run's queue stands on, or passes on from it while tunes cannot play:
   * forward, where running out ends the list, or back, where running out restarts the tune that
   * was playing.
   */
  const settle = async (direction: ListStep, preread?: Playlist | null) => {
    const listId = runs.get()?.listId
    if (listId === undefined) return
    const turn = ++generation.current
    pendingTurn.current = turn
    const playlist = preread !== undefined ? preread : await read(db, listId)
    if (turn !== generation.current) return
    pendingTurn.current = null
    const base = runs.get()
    if (!base) return
    // A list deleted while it plays ends as its last tune ending would, with nothing to say.
    if (!playlist) {
      engine.pause()
      detach()
      return
    }
    const current: Run = { ...base, listName: playlist.name }
    let queue = current.queue
    for (;;) {
      const item = resolve(playlist, queue.current)
      if (item) {
        const target = { ...current, queue }
        commit(target)
        load(item, target)
        return
      }
      if (direction === 'back') {
        const back = previousInQueue(queue, 0)
        if (back.restart) {
          const loaded =
            loadedTune.current === null ? null : jumpTo(current.queue, loadedTune.current)
          commit({ ...current, queue: loaded ?? queue })
          engine.seek(0)
          return
        }
        queue = back.queue
        continue
      }
      misses.current += 1
      if (misses.current >= queue.count) return giveUp(current, queue)
      const moved = nextInQueue(queue, { manual: true, repeat: repeatRef.current, random })
      if (moved.ended) return runOut(current, queue)
      queue = moved.queue
    }
  }

  /** The queue's own item could not play: count it and move on. */
  const failed = (current: Run) => {
    if (counted.current === ownItem.current) return
    counted.current = ownItem.current
    misses.current += 1
    failures.current += 1
    if (misses.current >= current.queue.count) return giveUp(current, current.queue)
    const moved = nextInQueue(current.queue, { manual: true, repeat: repeatRef.current, random })
    if (moved.ended) giveUp(current, current.queue)
    else move(current, moved.queue, 'forward', trigger.current)
  }

  const onEnded = useEffectEvent(() => {
    const current = settled()
    if (!current) return
    const own = ownItem.current
    if (own?.kind === 'recording' && own.id === holding.current) return
    trigger.current = 'auto_advance'
    if (repeatRef.current === 'one') {
      load(ownItem.current!, current)
      return
    }
    const moved = nextInQueue(current.queue, { manual: false, repeat: repeatRef.current, random })
    // The last tune stays loaded and paused where it ended.
    if (moved.ended) detach()
    else move(current, moved.queue, 'forward', 'auto_advance')
  })

  const onEngineFailed = useEffectEvent(() => {
    const current = settled()
    if (current && engine.loads > handedAt.current) failed(current)
  })

  const onLoadFailed = (recordingId: string) => {
    const current = settled()
    if (current && ownItem.current?.id === recordingId) failed(current)
  }

  const onPlaying = useEffectEvent(() => {
    if (!settled()) return
    misses.current = 0
    failures.current = 0
  })

  useEffect(() => engine.onEnded(onEnded), [engine])
  // Repeat one replays the recording that ended, and so does repeat list when the list holds
  // one tune; anything else moves on or stops.
  const replays = useEffectEvent((recordingId: string): PlayAttribution | null => {
    const own = ownItem.current
    const current = settled()
    if (!current) return null
    const repeat = repeatRef.current
    if (repeat !== 'one' && !(repeat === 'list' && current.queue.count === 1)) return null
    if (own?.kind !== 'recording' || own.id !== recordingId || own.id === holding.current) {
      return null
    }
    return { source: 'list', queue: 'playlist', trigger: 'auto_advance' }
  })
  const playLog = usePlayLogControl()
  useEffect(() => playLog.replayedByQueue((recordingId) => replays(recordingId)), [playLog])
  useEffect(() => {
    let wasFailed = engine.getState().failed
    return engine.subscribe((state) => {
      const newlyFailed = state.failed && !wasFailed
      wasFailed = state.failed
      if (state.playing) onPlaying()
      if (newlyFailed) onEngineFailed()
    })
  }, [engine])
  // Nothing in flight plays or seeks once the provider is gone.
  useEffect(
    () => () => {
      generation.current += 1
      startTurn.current += 1
    },
    [],
  )

  // Anything but the queue's own item in the player, or the player closing, detaches. A
  // stopped list keeps its message through the close it caused, until `end`.
  const onItem = useEffectEvent((item: PlayerItem | null) => {
    if (item === ownItem.current) return
    if (starting.current && item !== null) {
      starting.current = false
      startTurn.current += 1
    }
    const current = runs.get()
    if (!current) return
    if (item === null && current.message !== null) return
    detach()
  })
  useEffect(() => {
    onItem(player.item)
  }, [player.item])

  // A run belongs to one user's database; a switch ends it, message and all.
  const seenDb = useRef(db)
  const onDb = useEffectEvent(() => {
    if (seenDb.current === db) return
    seenDb.current = db
    detach()
  })
  useEffect(() => {
    onDb()
  }, [db])

  const start = async (listId: string, options: { shuffle?: boolean } = {}) => {
    const shuffled = options.shuffle ?? preferShuffle()
    const turn = ++startTurn.current
    starting.current = true
    // Inside the tap, so iOS grants audio before the list's first tune asks for it.
    engine.prime()
    const playlist = await read(db, listId)
    if (turn !== startTurn.current || dbRef.current !== db) return
    starting.current = false
    if (!playlist) return
    const { playable } = playlistReport(
      playlist.entries,
      playlistAvailability(playlist, onlineRef.current),
    )
    // A list with nothing to play leaves whatever plays alone.
    if (playable.length === 0) return
    detach()
    misses.current = 0
    failures.current = 0
    playerRef.current.close()
    chooseShuffle(shuffled)
    const queue = createQueue(playable, { shuffled, random })
    trigger.current = 'tap'
    unreportedStart.current = {
      shuffle: shuffled,
      repeat: repeatRef.current,
      count: queue.count,
      listId,
    }
    commit({ db, listId, listName: playlist.name, queue, message: null })
    await settle('forward', playlist)
  }

  const jump = (tuneId: string) => {
    const current = runs.get()
    if (!current || current.message !== null) return false
    const queue = jumpTo(current.queue, tuneId)
    if (!queue) return false
    engine.prime()
    move(current, queue, 'forward', 'tap')
    return true
  }

  const next = () => {
    const current = runs.get()
    if (!current || current.message !== null) return
    engine.prime()
    const moved = nextInQueue(current.queue, { manual: true, repeat: repeatRef.current, random })
    if (!moved.ended) move(current, moved.queue, 'forward', 'skip')
    else {
      engine.pause()
      detach()
    }
  }

  const previous = () => {
    const current = runs.get()
    if (!current || current.message !== null) return
    engine.prime()
    // A pending turn has not reached the engine, whose position is still the last tune's.
    const pending = pendingTurn.current !== null
    const back = previousInQueue(current.queue, pending ? 0 : engine.getState().positionMs)
    if (!back.restart) move(current, back.queue, 'back', 'skip')
    else if (!pending) engine.seek(0)
  }

  const toggleShuffle = () => {
    const current = runs.get()
    const on = !(current?.queue.shuffled ?? preferShuffle())
    chooseShuffle(on)
    if (current) commit({ ...current, queue: setShuffled(current.queue, on, random) })
  }

  const cycleRepeat = () => {
    const mode = nextRepeat(repeatRef.current)
    writeStored(REPEAT_KEY, mode)
    setRepeat(mode)
  }

  const end = () => {
    const ours = holdsOwn()
    // Ending also drops a start still reading its list, so nothing begins after the end.
    starting.current = false
    startTurn.current += 1
    detach()
    if (ours) playerRef.current.close()
  }

  // Stable for consumers; each call runs the latest render's action.
  const actionsRef = useLatest({ start, jump, next, previous, toggleShuffle, cycleRepeat, end })
  const actions = useMemo<Omit<ListPlayback, 'active'>>(
    () => ({
      start: (listId, options) => actionsRef.current.start(listId, options),
      jump: (tuneId) => actionsRef.current.jump(tuneId),
      next: () => actionsRef.current.next(),
      previous: () => actionsRef.current.previous(),
      toggleShuffle: () => actionsRef.current.toggleShuffle(),
      cycleRepeat: () => actionsRef.current.cycleRepeat(),
      end: () => actionsRef.current.end(),
    }),
    [actionsRef],
  )
  const reportHolding = useMemo(
    () => (recordingId: string | null) => {
      holding.current = recordingId
    },
    [],
  )
  const loadFailedRef = useLatest(onLoadFailed)
  const reportLoadFailed = useMemo(
    () => (recordingId: string) => loadFailedRef.current(recordingId),
    [loadFailedRef],
  )

  // The name live, so a rename shows while the list plays.
  const listRow = useLiveQuery(
    async () => (run ? ((await db.lists.get(run.listId)) ?? null) : null),
    [db, run?.listId],
  )
  // Checked during render, so the render that sees a new database never shows the last one's.
  const shown = run?.db === db ? run : null
  // Read in render: the refs change only alongside a commit of the run or a new player item,
  // so a render follows each change. The player itself, not its ref, which lags a render.
  const isSettled =
    shown?.message === null &&
    pendingTurn.current === null &&
    ownItem.current !== null &&
    player.item === ownItem.current
  const active = useMemo<ListPlaybackActive | null>(
    () =>
      shown && {
        listId: shown.listId,
        listName: listRow?.id === shown.listId ? listRow.name : shown.listName,
        position: shown.queue.position,
        count: shown.queue.count,
        shuffled: shown.queue.shuffled,
        repeat,
        message: shown.message,
        settled: isSettled,
      },
    [shown, listRow, repeat, isSettled],
  )

  const value = useMemo<ListPlayback>(() => ({ active, ...actions }), [active, actions])
  return (
    <ListPlaybackContext.Provider value={value}>
      <LoadFailedContext.Provider value={reportLoadFailed}>
        <ListHoldContext.Provider value={reportHolding}>{children}</ListHoldContext.Provider>
      </LoadFailedContext.Provider>
    </ListPlaybackContext.Provider>
  )
}
