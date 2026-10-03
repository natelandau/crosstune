import { IonButton } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronUp, Pause, Play, Repeat, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useDb } from '../../db/DbProvider'
import type { RecordingFile } from '../../db/recordings'
import { liveTune } from '../../db/tunes'
import type { LocalRecording, LocalRecordingLink } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import { useOnline } from '../../sync/SyncProvider'
import { displayTitle } from '../links/display'
import {
  DOWNLOAD_FAILED,
  DOWNLOADING,
  fileStateLabel,
  formatDuration,
  NOT_AVAILABLE,
} from '../recording/format'
import { loopHolds, useLoopFollow } from '../practice/useLoopFollow'
import { useLoops } from '../practice/useLoops'
import { recordingTitle } from '../recordings/recordingRow'
import { useRecordingScreen } from '../recording-screen/useRecordingScreen'
import { embedFor, type Embed } from './embed'
import { EmbedFrame } from './EmbedFrame'
import { dockHeight } from './playerHeight'
import { usePlaybackEngine } from './PlaybackEngineProvider'
import { playbackWindow, type PlaybackWindow } from './playbackWindow'
import { useCurrentAudio } from './useCurrentAudio'
import { useRecordingDownload } from './useRecordingDownload'
import { usePlayer } from './usePlayer'
import {
  CLOSE_PLAYER,
  ELAPSED_LABEL,
  OPEN_RECORDING,
  PAUSE,
  PITCH_BADGE,
  PITCH_LABEL,
  PITCH_UNAVAILABLE,
  PLAY,
  REMAINING_LABEL,
  REPEAT_LOOP,
  REPEATING_BADGE,
  SPEED_BADGE,
  SPEED_LABEL,
} from './transportCopy'
import { useLatest } from '../../ui/useLatest'

export const PLAY_FAILED = "Couldn't play"

type Shown =
  | { kind: 'link'; link: LocalRecordingLink; embed: Embed }
  | {
      kind: 'recording'
      recording: LocalRecording
      file: RecordingFile | null
      tuneTitle: string | null
    }

function shownEquals(a: Shown | null, b: Shown | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.kind === 'link' && b.kind === 'link') return a.link === b.link && a.embed === b.embed
  if (a.kind === 'recording' && b.kind === 'recording')
    return a.recording === b.recording && a.file === b.file
  return false
}

function RecordingBody({
  recording,
  file,
  title,
}: {
  recording: LocalRecording
  file: RecordingFile | null
  title: string
}) {
  const engine = usePlaybackEngine()
  const recordingScreen = useRecordingScreen()
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
  // by one render whenever the blob is replaced: React re-renders with the new file's props,
  // and so a fresh `span`, before the mint effect above has minted the new blob a `src` and
  // this component's own `[src]` effect has had a chance to load it. Comparing the two tells
  // the effects below whether the recording they would adjust is the one actually loaded, or
  // one already superseded and about to be replaced by the load this same render also
  // triggers.
  const blobIdentity = `${recording.id}:${hasBlob}:${file?.blob_rev ?? ''}:${blobStartMs}`
  const loadedBlobIdentity = useRef<string | null>(null)

  // Every recording reaches the dock from a Play tap, so its first url loads and plays it.
  // This body is keyed on the recording, so any later url is the same recording's blob
  // replaced (a trim landing), which keeps its place and plays only if it was playing. `src`
  // is the only reactive trigger; the event always reads the latest span, settings, and title,
  // and the settings the recording screen holds win over the row's, as they do below.
  const onSrcReady = useEffectEvent(() => {
    if (!src || !span) return
    const replaced = loadedBlobIdentity.current === null ? null : engine.getState()
    const held = recordingScreen.held(recording.id)
    engine.load(
      src,
      span,
      {
        speedPercent: held?.speedPercent ?? recording.speed_percent,
        pitchCents: held?.pitchCents ?? recording.pitch_cents,
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

  // A speed or pitch change from another device, or a settled one from the recording screen:
  // adjusts the running graph without restarting or moving playback. One effect per field, so
  // a write of one never re-applies the other's stored value over a newer live one.
  // A value the recording screen is still settling wins over the stored one, which can be
  // that screen's own earlier write landing.
  const onSpeedChange = useEffectEvent(() => {
    if (!src || loadedBlobIdentity.current !== blobIdentity) return
    engine.setSpeed(recordingScreen.held(recording.id)?.speedPercent ?? recording.speed_percent)
  })
  useEffect(() => {
    onSpeedChange()
  }, [recording.speed_percent])
  const onPitchChange = useEffectEvent(() => {
    if (!src || loadedBlobIdentity.current !== blobIdentity) return
    engine.setPitch(recordingScreen.held(recording.id)?.pitchCents ?? recording.pitch_cents)
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

  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  const playButton = useRef<HTMLIonButtonElement>(null)

  if (src) {
    const remainingMs = Math.max(0, state.lengthMs - state.positionMs)
    const speedText = recording.speed_percent !== 100 ? SPEED_BADGE(recording.speed_percent) : null
    const pitchText = recording.pitch_cents !== 0 ? PITCH_BADGE(recording.pitch_cents) : null
    const pitchUnavailable = state.pitchUnavailable && recording.pitch_cents !== 0
    return (
      <div className="flex h-14 items-center gap-2">
        <IonButton
          ref={playButton}
          fill="clear"
          aria-label={state.playing ? PAUSE : PLAY}
          onClick={() => (state.playing ? engine.pause() : engine.play())}
        >
          {state.playing ? (
            <Pause aria-hidden="true" fill="currentColor" className="size-5" />
          ) : (
            <Play aria-hidden="true" fill="currentColor" className="ml-0.5 size-5" />
          )}
        </IonButton>
        {state.failed ? (
          <p role="status" className="type-footnote min-w-0 flex-1 truncate">
            {PLAY_FAILED}
          </p>
        ) : (
          <>
            {speedText || pitchText ? (
              <span
                data-playback-badge
                className="type-footnote inline-flex h-6 shrink-0 items-center rounded-full bg-(--fill-tertiary) px-2 tabular-nums"
              >
                {speedText ? (
                  <span>
                    <span className="sr-only">{SPEED_LABEL} </span>
                    {speedText}
                  </span>
                ) : null}
                {speedText && pitchText ? ' ' : null}
                {pitchText ? (
                  <span>
                    <span className="sr-only">{PITCH_LABEL} </span>
                    {pitchText}
                  </span>
                ) : null}
              </span>
            ) : null}
            {state.repeat && state.loop ? (
              // Never narrower than its two 44 px targets, however long the label.
              <span data-repeat-badge className="flex min-w-22 shrink items-center">
                <button
                  type="button"
                  className="flex min-h-11 min-w-11 items-center"
                  onClick={() => recordingScreen.open(recording.id)}
                >
                  <span className="type-footnote inline-flex h-6 min-w-0 items-center rounded-full bg-(--ion-color-primary) px-2 text-(--ion-color-primary-contrast)">
                    <span className="truncate">{REPEATING_BADGE(state.loop.label)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={REPEAT_LOOP(state.loop.label)}
                  aria-pressed="true"
                  className="grid size-11 shrink-0 place-items-center"
                  onClick={() => {
                    // As deselecting does, so a drag's hold cannot outlive the loop it held.
                    loopHolds(engine).drop()
                    engine.setLoop(null)
                    engine.setRepeat(false)
                    // The toggle leaves with the badge, so focus moves to the transport beside it.
                    playButton.current?.shadowRoot?.querySelector('button')?.focus()
                  }}
                >
                  <Repeat aria-hidden="true" className="size-5 text-(--ion-color-primary)" />
                </button>
              </span>
            ) : null}
            {pitchUnavailable ? (
              <p role="status" className="type-footnote min-w-0 truncate">
                {PITCH_UNAVAILABLE}
              </p>
            ) : null}
            <p
              role="timer"
              aria-live="off"
              aria-label={`${ELAPSED_LABEL} ${formatDuration(state.positionMs)}`}
              className="type-footnote shrink-0 tabular-nums"
            >
              {formatDuration(state.positionMs)}
            </p>
            <progress
              aria-label={`${title} progress`}
              value={state.lengthMs > 0 ? state.positionMs : 0}
              max={Math.max(state.lengthMs, 1)}
              className="h-1 min-w-0 flex-1"
            />
            <p
              role="timer"
              aria-live="off"
              aria-label={`${REMAINING_LABEL} ${formatDuration(remainingMs)}`}
              className="type-footnote shrink-0 tabular-nums"
            >
              -{formatDuration(remainingMs)}
            </p>
          </>
        )}
      </div>
    )
  }
  const label = !online
    ? OFFLINE
    : failed
      ? DOWNLOAD_FAILED
      : recording.state === 'ready'
        ? DOWNLOADING
        : fileStateLabel(recording, file ?? undefined)
  return (
    <div className="flex h-14 items-center gap-2">
      <p role="status" className="type-footnote min-w-0 flex-1 truncate">
        {label || NOT_AVAILABLE}
      </p>
      {/* Offline refuses the tap by not offering it, rather than leaving a control that cannot work. */}
      {failed && online ? (
        <IonButton fill="outline" onClick={retry}>
          Retry
        </IonButton>
      ) : null}
    </div>
  )
}

/**
 * The one player, in the tab frame's bottom slot so it sits above the tab bar and stays put as
 * the musician moves between screens. It reserves its own room there, so a page never ends up
 * behind it and the record button's dome keeps its clearance.
 */
export function Dock() {
  const db = useDb()
  const { item, close, returnFocus } = usePlayer()
  const recordingScreen = useRecordingScreen()

  // Tagging the result with its item keeps a read for the previous item from being
  // taken as the answer for the new one while the new read is pending.
  const loaded = useLiveQuery(async () => {
    if (item === null) return null
    if (item.kind === 'link') {
      return {
        item,
        link: (await db.recording_links.get(item.id)) ?? null,
        recording: null,
        file: null,
        tuneTitle: null,
      }
    }
    const recording = (await db.recordings.get(item.id)) ?? null
    const tune = recording?.tune_id ? await db.tunes.get(recording.tune_id) : null
    return {
      item,
      link: null,
      recording,
      file: (await db.recording_files.get(item.id)) ?? null,
      tuneTitle: liveTune(tune)?.title ?? null,
    }
  }, [db, item])
  const current = loaded && loaded.item === item ? loaded : undefined
  const link = current?.link && !current.link.deleted_at ? current.link : null
  const recording = current?.recording && !current.recording.deleted_at ? current.recording : null
  // Every recording reaches the dock from a Play tap, so the player always starts playing.
  const embed = useMemo(() => (link ? embedFor(link, { autoplay: true }) : null), [link])
  // A recording has no embed to fail; a missing or deleted row is what closes it instead.
  const unplayable = current !== undefined && item?.kind === 'link' && embed === null
  const missingRecording = current !== undefined && item?.kind === 'recording' && recording === null

  // Holding the last playable recording through a replacement read keeps the dock and
  // its reserved room mounted, so the page height and scroll position do not jump.
  const [shown, setShown] = useState<Shown | null>(null)
  const resolved: Shown | null =
    link && embed
      ? { kind: 'link', link, embed }
      : recording
        ? {
            kind: 'recording',
            recording,
            file: current?.file ?? null,
            tuneTitle: current?.tuneTitle ?? null,
          }
        : null
  const next = resolved ?? (item !== null && current === undefined ? shown : null)
  if (!shownEquals(next, shown)) setShown(next)

  useEffect(() => {
    if (unplayable || missingRecording) close()
  }, [unplayable, missingRecording, close])

  // Removing the focused close button drops focus to the body, so the section notes on its
  // way out whether it held focus. Focus moves only once the player is unloaded, so a Play
  // row button already reads Play when it takes focus.
  const hadFocus = useRef(false)
  const sectionRef = useCallback((section: HTMLElement) => {
    return () => {
      hadFocus.current = section.contains(document.activeElement)
    }
  }, [])
  useLayoutEffect(() => {
    if (item !== null || !hadFocus.current) return
    hadFocus.current = false
    returnFocus()
    // The page's own read of the same change can remove the opener a moment later, which
    // drops focus to the body; checking again after a frame sends it to the main region.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) returnFocus()
    })
    return () => cancelAnimationFrame(frame)
  }, [item, returnFocus])

  const height =
    next === null
      ? null
      : next.kind === 'link'
        ? dockHeight({ kind: 'link', height: next.embed.height })
        : dockHeight({ kind: 'recording' })

  // Chrome fixed to the viewport from outside the tab frame rises by this to clear the player:
  // its height plus the record button's cap. Anything inside the frame already clears it,
  // because the frame has given the player a box of its own.
  useLayoutEffect(() => {
    if (height === null) return
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--player-dock-offset', `calc(${height}px + var(--tab-bar-cap))`)
    return () => {
      rootStyle.removeProperty('--player-dock-offset')
    }
  }, [height])

  if (!next || height === null) return null

  const title =
    next.kind === 'link'
      ? displayTitle(next.link)
      : recordingTitle({
          recording: next.recording,
          file: next.file ?? undefined,
          tuneId: null,
          tuneTitle: next.tuneTitle,
        })

  return (
    // The padding is the room the record button's dome rises into, so the dome is never covered.
    // The pages above are the only item in the frame's column that gives way, so a short
    // viewport takes its room out of them rather than out of the player.
    // Positioned, like the tab bar beside it, so the router outlet's own positioned box cannot
    // paint a page's overscroll over the player; the bar still wins, coming later in the slot.
    // The frame's own background covers that padding too, so no scrolled row shows through it.
    <div slot="bottom" className="player-dock-frame relative shrink-0 pb-(--tab-bar-cap)">
      <section
        ref={sectionRef}
        aria-label="Player"
        style={{ height }}
        className="player-dock flex flex-col py-1.5"
      >
        {/* The column and the gutter a screen's own body uses, so the loaded item's name starts
            where the lines above it do rather than out at the column's edge. */}
        <div className="mx-auto flex h-full w-full max-w-(--measure) flex-col px-5">
          <div className="flex h-11 shrink-0 items-center gap-2">
            {next.kind === 'recording' ? (
              // The whole line up to Close opens the screen, and the chevron says it rises from here.
              <button
                type="button"
                aria-label={OPEN_RECORDING(title)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => recordingScreen.open(next.recording.id)}
              >
                <span className="type-headline min-w-0 flex-1 truncate">{title}</span>
                <ChevronUp
                  aria-hidden="true"
                  className="size-5 shrink-0 text-(--ion-color-medium)"
                />
              </button>
            ) : (
              <span className="type-headline min-w-0 flex-1 truncate">{title}</span>
            )}
            <IonButton fill="clear" aria-label={CLOSE_PLAYER} onClick={close}>
              <X aria-hidden="true" className="size-5" />
            </IonButton>
          </div>
          {next.kind === 'link' ? (
            <EmbedFrame embed={next.embed} title={title} />
          ) : (
            <RecordingBody
              key={next.recording.id}
              recording={next.recording}
              file={next.file}
              title={title}
            />
          )}
        </div>
      </section>
    </div>
  )
}
