import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import type { Embed } from './embed'
import { EmbedFrame } from './EmbedFrame'

/** The share of the pane an embed may take, so the page above it stays in view. */
export const EMBED_SHARE = 0.4

/**
 * A provider's player, growing up out of the now-playing bar. It never takes more than
 * `EMBED_SHARE` of the pane the bar docks in.
 */
export function EmbedPanel({ embed, title }: { embed: Embed; title: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [cap, setCap] = useState<number | null>(null)

  // The pane is whatever holds the slot the bar docks in, which changes with the frame. The
  // slot can take the bar a commit after the panel mounts, so until a pane is found the
  // panel watches its own box, which changes as it lands in a slot. Only the pane is watched
  // after that, since the cap resizes the panel and never the pane.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    let pane: Element | null = null
    const measure = (apply: (cap: number) => void) => {
      const next = element.closest('[data-now-playing]')?.parentElement ?? null
      if (next !== pane) {
        observer.unobserve(pane ?? element)
        pane = next
        observer.observe(pane ?? element)
      }
      if (pane) apply(Math.floor(pane.clientHeight * EMBED_SHARE))
    }
    // Flushed, so the capped height is what first paints after the panel lands.
    const observer = new ResizeObserver(() => measure((next) => flushSync(() => setCap(next))))
    const onResize = () => measure(setCap)
    measure(setCap)
    if (!pane) observer.observe(element)
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div
      ref={ref}
      data-embed
      className="overflow-y-auto px-3 pt-2 [&>iframe]:max-h-(--embed-cap)"
      style={cap === null ? undefined : ({ '--embed-cap': `${cap}px` } as CSSProperties)}
    >
      <EmbedFrame embed={embed} title={title} />
    </div>
  )
}
