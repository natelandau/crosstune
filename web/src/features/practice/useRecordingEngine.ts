import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import type { PlaybackEngine } from '../player/playbackEngine'
import { playbackWindow } from '../player/playbackWindow'
import { RECORDING_SCREEN_ORIGIN } from '../player/playLog'
import { isPlaying, usePlayer } from '../player/usePlayer'
import type { RecordingView } from '../recordings/useRecordings'
import { UnloadedRecordingEngine } from './unloadedRecordingEngine'

/**
 * The engine every control for `view`'s recording drives: the player's while it has the
 * recording loaded, else one of its own that never changes playback, whose Play loads the
 * recording at its playhead. `loaded` says which. Call it once per page, so the controls share
 * one playhead and loop.
 * After its Play, the page's engine stays in use until the player's has taken the recording up,
 * so the controls never show the recording before it, or nothing, while it loads.
 */
export function useRecordingEngine(view: RecordingView | null): {
  engine: PlaybackEngine
  loaded: boolean
} {
  const engine = usePlaybackEngine()
  const player = usePlayer()
  const recordingId = view?.recording.id ?? null
  const loaded = recordingId !== null && isPlaying(player, { kind: 'recording', id: recordingId })

  const trimStartMs = view?.recording.trim_start_ms
  const trimEndMs = view?.recording.trim_end_ms
  const sourceDurationMs = view?.recording.source_duration_ms
  const blobStartMs = view?.file?.blob_start_ms ?? 0
  const localDurationMs = view?.file?.local_duration_ms ?? null
  const span = useMemo(
    () =>
      playbackWindow(
        {
          trim_start_ms: trimStartMs ?? 0,
          trim_end_ms: trimEndMs ?? null,
          source_duration_ms: sourceDurationMs ?? null,
        },
        { blob_start_ms: blobStartMs, local_duration_ms: localDurationMs },
      ),
    [trimStartMs, trimEndMs, sourceDurationMs, blobStartMs, localDurationMs],
  )
  // Holds no audio, so one per page costs nothing while the player has the recording.
  const [unloaded] = useState(() => {
    const created = new UnloadedRecordingEngine()
    created.setWindow(span)
    return created
  })
  // The engine's load count as Play handed the recording over, until the engine has loaded it.
  const [handedAt, setHandedAt] = useState<number | null>(null)
  if (!loaded && handedAt !== null) setHandedAt(null)
  useLayoutEffect(() => unloaded.setWindow(span), [unloaded, span])
  useLayoutEffect(() => {
    if (recordingId === null) return
    return unloaded.onPlay((start) => {
      setHandedAt(engine.loads)
      player.play(
        { kind: 'recording', id: recordingId },
        { ...start, origin: RECORDING_SCREEN_ORIGIN, fromPage: true },
      )
    })
  }, [unloaded, engine, player, recordingId])
  useEffect(() => {
    if (handedAt === null) return
    // Unloading the recording before it also counts as a load, so only one with audio, or one
    // that failed, does.
    const check = () => {
      const state = engine.getState()
      if (engine.loads > handedAt && (state.lengthMs > 0 || state.playing || state.failed)) {
        setHandedAt(null)
      }
    }
    check()
    return engine.subscribe(check)
  }, [engine, handedAt])
  const holds = loaded && handedAt === null
  return { engine: holds || view === null ? engine : unloaded, loaded: holds }
}
