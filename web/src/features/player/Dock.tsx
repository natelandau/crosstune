import { IonButton } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDb } from '../../db/DbProvider'
import type { RecordingFile } from '../../db/recordings'
import { liveTune } from '../../db/tunes'
import type { LocalRecording, LocalRecordingLink } from '../../db/types'
import { OFFLINE } from '../../sync/labels'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import { displayTitle } from '../links/display'
import { DOWNLOAD_FAILED, DOWNLOADING, fileStateLabel } from '../recording/format'
import { recordingTitle } from '../recordings/recordingRow'
import { embedFor, type Embed } from './embed'
import { dockHeight, VIDEO_HEIGHT_PX } from './playerHeight'
import { usePlayer } from './usePlayer'

export const CLOSE_PLAYER = 'Close player'

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
  const engine = useSyncEngine()
  const online = useOnline()
  const [fetched, setFetched] = useState<{ id: string; blob: Blob | null } | null>(null)
  const blob = file?.blob ?? (fetched?.id === recording.id ? fetched.blob : null)
  const failed = !blob && recording.state === 'ready' && fetched?.id === recording.id
  useEffect(() => {
    if (blob || recording.state !== 'ready') return
    let cancelled = false
    void engine.download(recording.id).then((result) => {
      if (!cancelled) setFetched({ id: recording.id, blob: result })
    })
    return () => {
      cancelled = true
    }
  }, [blob, engine, recording.id, recording.state])
  // A read of the same row from IndexedDB can hand back a Blob that is not the same
  // object even though its content did not change, so the effect below keys on identity
  // (the recording and whether a blob exists) and reads the current blob through this ref,
  // kept in sync after every render rather than during it.
  const blobRef = useRef(blob)
  useEffect(() => {
    blobRef.current = blob
  })
  const hasBlob = !!blob
  // Minted and revoked in the same effect (not useMemo, which StrictMode can
  // double-invoke without a matching cleanup) so every URL is revoked exactly once.
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
  }, [recording.id, hasBlob])
  if (src)
    return <audio src={src} controls autoPlay aria-label={title} className="block h-14 w-full" />
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
        {label || 'Not available'}
      </p>
      {/* Offline refuses the tap by not offering it, rather than leaving a control that cannot work. */}
      {failed && online ? (
        <IonButton
          fill="outline"
          onClick={() => {
            // Clearing the failed result shows Downloading again until this attempt settles.
            setFetched(null)
            void engine.download(recording.id).then((result) => {
              setFetched({ id: recording.id, blob: result })
            })
          }}
        >
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

  const embedHeight = next?.kind === 'link' ? next.embed.height : undefined
  const frameHeight = embedHeight === 'video' ? VIDEO_HEIGHT_PX : embedHeight
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
            <span className="type-headline min-w-0 flex-1 truncate">{title}</span>
            <IonButton fill="clear" aria-label={CLOSE_PLAYER} onClick={close}>
              <X aria-hidden="true" className="size-5" />
            </IonButton>
          </div>
          {next.kind === 'link' ? (
            // A new src navigates the frame anyway; a fresh element also makes the frame take
            // its sandbox and allow flags before that navigation starts.
            <iframe
              key={next.embed.src}
              src={next.embed.src}
              title={title}
              allow={next.embed.allow}
              sandbox={next.embed.sandbox}
              height={frameHeight}
              className={
                embedHeight === 'video' ? 'mx-auto block w-full max-w-[356px]' : 'block w-full'
              }
            />
          ) : (
            <RecordingBody recording={next.recording} file={next.file} title={title} />
          )}
        </div>
      </section>
    </div>
  )
}
