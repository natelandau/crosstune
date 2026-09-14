import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLink } from '../../db/types'
import { displayTitle } from '../links/display'
import { embedFor, type Embed } from './embed'
import { usePlayer } from './usePlayer'

const VIDEO_HEIGHT_PX = 200
// The section's `p-1.5` above and below plus its `h-11` header.
const CHROME_HEIGHT_PX = 6 + 44 + 6

interface Shown {
  link: LocalRecordingLink
  embed: Embed
}

export function PlayerDock() {
  const db = useDb()
  const { linkId, close, returnFocus } = usePlayer()

  // Tagging the result with its id keeps a read for the previous link from being
  // taken as the answer for the new one while the new read is pending.
  const loaded = useLiveQuery(
    async () =>
      linkId === null ? null : { linkId, row: (await db.recording_links.get(linkId)) ?? null },
    [db, linkId],
  )
  const current = loaded && loaded.linkId === linkId ? loaded : undefined
  const link = current?.row && !current.row.deleted_at ? current.row : null
  // Every recording reaches the dock from a Play tap, so the player always starts playing.
  const embed = useMemo(() => (link ? embedFor(link, { autoplay: true }) : null), [link])
  const unplayable = current !== undefined && embed === null

  // Holding the last playable recording through a replacement read keeps the dock and
  // its spacer mounted, so the page height and scroll position do not jump.
  const [shown, setShown] = useState<Shown | null>(null)
  const resolved = link && embed ? { link, embed } : null
  const next = resolved ?? (linkId !== null && current === undefined ? shown : null)
  if (next?.link !== shown?.link || next?.embed !== shown?.embed) setShown(next)

  useEffect(() => {
    if (unplayable) close()
  }, [unplayable, close])

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
    if (linkId !== null || !hadFocus.current) return
    hadFocus.current = false
    returnFocus()
    // The page's own read of the same change can remove the opener a moment later, which
    // drops focus to the body; checking again after a frame sends it to the main region.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) returnFocus()
    })
    return () => cancelAnimationFrame(frame)
  }, [linkId, returnFocus])

  if (!next) return null

  const title = displayTitle(next.link)
  const embedHeight = next.embed.height
  const frameHeight = embedHeight === 'video' ? VIDEO_HEIGHT_PX : embedHeight
  const dockHeight = CHROME_HEIGHT_PX + frameHeight

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
        {/* A new src navigates the frame anyway; a fresh element also makes the frame take
            its sandbox and allow flags before that navigation starts. */}
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
      </section>
    </>
  )
}
