import { useReducedMotionConfig } from 'motion/react'
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useStampedDensity } from '../platform/density'

const FADE = '1.5rem'

function maskFor(start: boolean, end: boolean): string | undefined {
  if (!start && !end) return undefined
  const from = start ? `transparent, black ${FADE}` : 'black'
  const to = end ? `black calc(100% - ${FADE}), transparent` : 'black'
  return `linear-gradient(to right, ${from}, ${to})`
}

/**
 * Scrolls the row sideways, and nothing else, just far enough to show `el` clear of the edge
 * fade. scrollIntoView would also scroll every ancestor, the page included.
 */
function reveal(row: HTMLElement, el: HTMLElement, behavior: ScrollBehavior): void {
  const bounds = row.getBoundingClientRect()
  const box = el.getBoundingClientRect()
  const inset = parseFloat(getComputedStyle(row).paddingInlineStart)
  if (box.left < bounds.left + inset) {
    row.scrollTo({ left: row.scrollLeft + box.left - bounds.left - inset, behavior })
  } else if (box.right > bounds.right - inset) {
    row.scrollTo({ left: row.scrollLeft + box.right - bounds.right + inset, behavior })
  }
}

/**
 * A named group of filter capsules. On touch it is one line that scrolls sideways, fading at an
 * edge only while more remains and bringing a newly set capsule into view; on pointer it wraps.
 */
export function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  const touch = useStampedDensity() === 'touch'
  const reduceMotion = useReducedMotionConfig() ?? false
  const ref = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ start: false, end: false })
  const knownSet = useRef<Set<string> | null>(null)

  const measure = useCallback(() => {
    const row = ref.current
    if (!row) return
    const start = row.scrollLeft > 1
    const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1
    setMore((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  useLayoutEffect(() => {
    const row = ref.current
    if (!row) return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    for (const child of row.children) observer.observe(child)
    measure()
    return () => observer.disconnect()
  }, [measure, children, touch])

  useLayoutEffect(() => {
    const row = ref.current
    if (!row) return
    const now = new Set<string>()
    const seeding = knownSet.current === null
    for (const el of row.querySelectorAll<HTMLElement>('[data-set]')) {
      const name = el.dataset.set ?? ''
      now.add(name)
      // Capsules set when the row first shows stay where they are; the row starts at its edge.
      if (touch && !seeding && !knownSet.current?.has(name)) {
        reveal(row, el, reduceMotion ? 'instant' : 'smooth')
      }
    }
    knownSet.current = now
  }, [children, touch, reduceMotion])

  const mask = touch ? maskFor(more.start, more.end) : undefined
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      onScroll={measure}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
      className={`flex [scrollbar-width:none] gap-2 px-4 py-1 [&::-webkit-scrollbar]:hidden ${
        touch ? 'overflow-x-auto [&>*]:shrink-0' : 'flex-wrap'
      }`}
    >
      {children}
    </div>
  )
}
