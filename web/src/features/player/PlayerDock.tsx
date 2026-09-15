import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RecordingFile } from '../../db/recordings'
import { useDb } from '../../db/DbProvider'
import { liveSong } from '../../db/songs'
import type { LocalRecording, LocalRecordingLink } from '../../db/types'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import { displayTitle } from '../links/display'
import { fileStateLabel } from '../recording/format'
import { embedFor, type Embed } from './embed'
import { usePlayer } from './usePlayer'

const VIDEO_HEIGHT_PX = 200
export const AUDIO_HEIGHT_PX = 56
// The section's `p-1.5` above and below plus its `h-11` header.
const CHROME_HEIGHT_PX = 6 + 44 + 6

type Shown =
  | { kind: 'link'; link: LocalRecordingLink; embed: Embed }
  | {
      kind: 'recording'
      recording: LocalRecording
      file: RecordingFile | null
      songTitle: string | null
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
    ? 'Offline'
    : failed
      ? "Couldn't download"
      : recording.state === 'ready'
        ? 'Downloading'
        : fileStateLabel(recording, file ?? undefined)
  return (
    <div className="flex h-14 items-center gap-2 text-sm opacity-70">
      <p role="status" className="flex-1">
        {label || 'Not available'}
      </p>
      {failed && online ? (
        <button
          type="button"
          className="btn btn-sm min-h-11"
          onClick={() => {
            // Clearing the failed result shows Downloading again until this attempt settles.
            setFetched(null)
            void engine.download(recording.id).then((result) => {
              setFetched({ id: recording.id, blob: result })
            })
          }}
        >
          Retry
        </button>
      ) : null}
    </div>
  )
}

export function PlayerDock() {
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
        songTitle: null,
      }
    }
    const recording = (await db.recordings.get(item.id)) ?? null
    const song = recording?.song_id ? await db.songs.get(recording.song_id) : null
    return {
      item,
      link: null,
      recording,
      file: (await db.recording_files.get(item.id)) ?? null,
      songTitle: liveSong(song)?.title ?? null,
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
  // its spacer mounted, so the page height and scroll position do not jump.
  const [shown, setShown] = useState<Shown | null>(null)
  const resolved: Shown | null =
    link && embed
      ? { kind: 'link', link, embed }
      : recording
        ? {
            kind: 'recording',
            recording,
            file: current?.file ?? null,
            songTitle: current?.songTitle ?? null,
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
  const dockHeight =
    next?.kind === 'recording'
      ? CHROME_HEIGHT_PX + AUDIO_HEIGHT_PX
      : frameHeight === undefined
        ? null
        : CHROME_HEIGHT_PX + frameHeight

  // Floating controls elsewhere in the tree, such as the catalog's add link, offset by this to stay above the player.
  useLayoutEffect(() => {
    if (dockHeight === null) return
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--player-dock-height', `${dockHeight}px`)
    return () => {
      rootStyle.removeProperty('--player-dock-height')
    }
  }, [dockHeight])

  if (!next || dockHeight === null) return null

  const title =
    next.kind === 'link'
      ? displayTitle(next.link)
      : (next.recording.label ?? next.songTitle ?? 'Recording')

  return (
    <>
      <div aria-hidden="true" style={{ height: dockHeight }} />
      <section
        ref={sectionRef}
        aria-label="Player"
        style={{ height: dockHeight }}
        className="bg-base-200 rounded-box fixed right-4 bottom-[calc(4rem+env(safe-area-inset-bottom))] left-4 z-10 flex flex-col p-1.5 shadow sm:left-auto sm:w-[368px]"
      >
        <div className="flex h-11 shrink-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm min-h-11 min-w-11"
            aria-label="Close player"
            onClick={close}
          >
            ✕
          </button>
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
      </section>
    </>
  )
}
