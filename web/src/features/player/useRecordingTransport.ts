import {
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { RecordingFile } from '../../db/recordings'
import type { LocalRecording } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import { useOnline } from '../../sync/SyncProvider'
import { useLatest } from '../../ui/useLatest'
import { loopHolds, useLoopFollow } from '../practice/useLoopFollow'
import { useLoops } from '../practice/useLoops'
import { DOWNLOAD_FAILED, DOWNLOADING, fileStateLabel, NOT_AVAILABLE } from '../../text/format'
import type { HeldSettings } from '../practice/usePracticeOverlay'
import type { PlaybackState } from './playbackEngine'
import { usePlaybackEngine } from './PlaybackEngineProvider'
import { playbackWindow, type PlaybackWindow } from './playbackWindow'
import { PITCH_BADGE, SPEED_BADGE } from './transportCopy'
import { useCurrentAudio } from './useCurrentAudio'
import { LoadFailedContext } from './useListPlayback'
import { useRecordingDownload } from './useRecordingDownload'

export interface RecordingTransportOptions {
  recording: LocalRecording
  file: RecordingFile | null
  /** The recording's title, for the lock screen. */
  title: string
  /** What practice plays ahead of the row, which wins over the row's settings. */
  held: () => HeldSettings | null
}

export interface RecordingTransport {
  state: PlaybackState
  toggle: () => void
  seek: (ms: number) => void
  remainingMs: number
  /** The speed badge, or null at the default speed. */
  speedText: string | null
  /** The pitch badge, or null at the default pitch. */
  pitchText: string | null
  /** The stored pitch cannot apply on this device. */
  pitchUnavailable: boolean
  /** What stands in for the transport while there is no audio to play; null once there is. */
  status: string | null
  /** A retry can help: a download failed and the device is online. */
  canRetry: boolean
  retry: () => void
  /** Stops repeating: drops any held loop span, clears the loop, and turns repeat off. */
  repeatOff: () => void
}

/**
 * Loads a recording into the playback engine and keeps it there in step with its row. Mount it
 * keyed on the recording, since a later blob is taken as the same recording's blob replaced.
 * Unloads the engine on unmount.
 */
export function useRecordingTransport({
  recording,
  file,
  title,
  held,
}: RecordingTransportOptions): RecordingTransport {
  const engine = usePlaybackEngine()
  const online = useOnline()
  const { blob, failed, retry } = useRecordingDownload(recording, file)
  useCurrentAudio(recording, file)
  useLoopFollow(useLoops(recording.id), {
    blobStartMs: file?.blob_start_ms ?? 0,
    trimStartMs: recording.trim_start_ms,
  })

  // A read of the same row from IndexedDB can hand back a Blob that is not the same
  // object even though its content did not change, so the effect below keys on identity
  // (the recording and whether a blob exists) and reads the current blob through this ref,
  // kept in sync after every render rather than during it.
  const blobRef = useLatest(blob)
  const hasBlob = !!blob
  // Minted and revoked in the same effect (not useMemo, which StrictMode can
  // double-invoke without a matching cleanup) so every URL is revoked exactly once. Keyed on
  // the blob's own identity, not just whether one exists, so a trim that replaces this file's
  // blob in place (same recording, same "has a blob") still mints a fresh url for it rather
  // than going on playing the one it replaced.
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!blobRef.current) return
    const url = URL.createObjectURL(blobRef.current)
    // Setting the url here, next to where it is minted, is what lets the cleanup below
    // revoke the exact url this effect created rather than one a discarded StrictMode pass minted.
    setSrc(url)
    return () => {
      URL.revokeObjectURL(url)
      setSrc(null)
    }
  }, [recording.id, hasBlob, file?.blob_rev, file?.blob_start_ms, blobRef])

  // The exact fields playbackWindow reads, named here so adding one it reads without adding
  // it here is a visible omission rather than a silently missed dependency.
  const blobStartMs = file?.blob_start_ms ?? null
  const localDurationMs = file?.local_duration_ms ?? null
  const span = useMemo<PlaybackWindow | null>(() => {
    if (blobStartMs === null) return null
    return playbackWindow(
      {
        trim_start_ms: recording.trim_start_ms,
        trim_end_ms: recording.trim_end_ms,
        source_duration_ms: recording.source_duration_ms,
      },
      { blob_start_ms: blobStartMs, local_duration_ms: localDurationMs },
    )
  }, [
    blobStartMs,
    localDurationMs,
    recording.trim_start_ms,
    recording.trim_end_ms,
    recording.source_duration_ms,
  ])

  // The blob identity backing the current `span`, computed fresh every render exactly like
  // `span` itself. `loadedBlobIdentity` (set only when a load actually runs) lags behind it
  // by one render whenever the blob is replaced: React re-renders with the new file, and so a
  // fresh `span`, before the mint effect above has minted the new blob a `src` and the `[src]`
  // effect has had a chance to load it. Comparing the two tells the effects below whether the
  // recording they would adjust is the one actually loaded, or one already superseded and
  // about to be replaced by the load this same render also triggers.
  const blobIdentity = `${recording.id}:${hasBlob}:${file?.blob_rev ?? ''}:${blobStartMs}`
  const loadedBlobIdentity = useRef<string | null>(null)

  // Every recording reaches the player from a Play tap, so its first url loads and plays it.
  // Any later url is the same recording's blob replaced (a trim landing), which keeps its
  // place and plays only if it was playing. `src` is the only reactive trigger; the event
  // always reads the latest span, settings, and title, and held settings win over the row's.
  const onSrcReady = useEffectEvent(() => {
    if (!src || !span) return
    const replaced = loadedBlobIdentity.current === null ? null : engine.getState()
    const hold = held()
    engine.load(
      src,
      span,
      {
        speedPercent: hold?.speedPercent ?? recording.speed_percent,
        pitchCents: hold?.pitchCents ?? recording.pitch_cents,
      },
      { title },
      { keepLoop: !!replaced },
    )
    if (replaced) engine.seek(replaced.positionMs)
    if (!replaced || replaced.playing) engine.play()
    loadedBlobIdentity.current = blobIdentity
  })
  useEffect(() => {
    onSrcReady()
  }, [src])

  // A trim narrowing the window while the same blob keeps playing: keeps position and
  // playing state, unlike a full reload.
  const onSpanChange = useEffectEvent(() => {
    if (!src || !span || loadedBlobIdentity.current !== blobIdentity) return
    engine.setWindow(span)
  })
  useEffect(() => {
    onSpanChange()
  }, [span])

  // A speed or pitch change from another device, or a settled one from practice:
  // adjusts the running graph without restarting or moving playback. One effect per field, so
  // a write of one never re-applies the other's stored value over a newer live one.
  // A value practice is still settling wins over the stored one, which can be
  // practice's own earlier write landing.
  const onSpeedChange = useEffectEvent(() => {
    if (!src || loadedBlobIdentity.current !== blobIdentity) return
    engine.setSpeed(held()?.speedPercent ?? recording.speed_percent)
  })
  useEffect(() => {
    onSpeedChange()
  }, [recording.speed_percent])
  const onPitchChange = useEffectEvent(() => {
    if (!src || loadedBlobIdentity.current !== blobIdentity) return
    engine.setPitch(held()?.pitchCents ?? recording.pitch_cents)
  })
  useEffect(() => {
    onPitchChange()
  }, [recording.pitch_cents])

  // A rename touches only what the lock screen shows.
  const onTitleChange = useEffectEvent(() => {
    if (!src || loadedBlobIdentity.current !== blobIdentity) return
    engine.setMetadata({ title })
  })
  useEffect(() => {
    onTitleChange()
  }, [title])

  useEffect(() => {
    return () => engine.unload()
  }, [engine])

  const reportLoadFailed = useContext(LoadFailedContext)
  const unloadable = !src && failed
  useEffect(() => {
    if (unloadable) reportLoadFailed(recording.id)
  }, [unloadable, reportLoadFailed, recording.id])

  const state = useSyncExternalStore(engine.subscribe, engine.getState)

  const toggle = useCallback(() => {
    if (engine.getState().playing) engine.pause()
    else engine.play()
  }, [engine])
  const seek = useCallback((ms: number) => engine.seek(ms), [engine])
  const repeatOff = useCallback(() => {
    // As deselecting does, so a drag's hold cannot outlive the loop it held.
    loopHolds(engine).drop()
    engine.setLoop(null)
    engine.setRepeat(false)
  }, [engine])

  const status = src
    ? null
    : (!online
        ? OFFLINE
        : failed
          ? DOWNLOAD_FAILED
          : recording.state === 'ready'
            ? DOWNLOADING
            : fileStateLabel(recording, file ?? undefined)) || NOT_AVAILABLE

  return {
    state,
    toggle,
    seek,
    remainingMs: Math.max(0, state.lengthMs - state.positionMs),
    speedText: recording.speed_percent !== 100 ? SPEED_BADGE(recording.speed_percent) : null,
    pitchText: recording.pitch_cents !== 0 ? PITCH_BADGE(recording.pitch_cents) : null,
    pitchUnavailable: state.pitchUnavailable && recording.pitch_cents !== 0,
    status,
    // Offline refuses the tap by not offering it, rather than leaving a control that cannot work.
    canRetry: !src && failed && online,
    retry,
    repeatOff,
  }
}
