import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  NEXT_SLIDE,
  PREVIOUS_SLIDE,
  SLIDE_COUNT,
  slideDotLabel,
  slideLabel,
  WELCOME_SLIDES,
} from '../../auth/links'
import { Button } from '../../ui/Button'
import { clamp } from '../../math'
import { SLIDE_ART } from './slideArt'

/** How far a finger moves before the carousel decides it is a swipe rather than a scroll. */
const SLOP_PX = 8
/** The share of the slide's width a swipe must travel to move on. */
const SWIPE_SHARE = 0.2

interface Swipe {
  pointerId: number
  x: number
  y: number
  /** Unset until the finger has moved past the slop, then whether it moves sideways. */
  sideways?: boolean
}

/**
 * The welcome slides, after the WAI-ARIA tabbed carousel pattern: a dot per slide in one tab
 * stop, arrows once the carousel is wider than a phone, the arrow keys while focus is inside,
 * and a swipe on touch. Never moves on its own.
 */
export function WelcomeCarousel({
  labelledBy,
}: {
  /** The id of the element that names the carousel's region. */
  labelledBy: string
}) {
  const [index, setIndex] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const swipe = useRef<Swipe | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const previousRef = useRef<HTMLButtonElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const dots = useRef<(HTMLButtonElement | null)[]>([])
  const last = SLIDE_COUNT - 1

  const show = (target: number) => {
    const next = clamp(target, 0, last)
    const active = document.activeElement
    // An arrow that reaches the end hides, which would drop its focus to the page.
    if (next === last && active === nextRef.current) previousRef.current?.focus()
    if (next === 0 && active === previousRef.current) nextRef.current?.focus()
    // The dots are one tab stop, so focus on a dot follows the slide.
    if (active instanceof HTMLButtonElement && dots.current.includes(active)) {
      dots.current[next]?.focus()
    }
    setIndex(next)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    // A modified arrow is the browser's or the system's, such as Back or select-by-word.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    event.preventDefault()
    show(index + (event.key === 'ArrowRight' ? 1 : -1))
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || swipe.current) return
    swipe.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const onPointerMove = (event: PointerEvent) => {
    const start = swipe.current
    if (!start || start.pointerId !== event.pointerId) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (start.sideways === undefined) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP_PX) return
      start.sideways = Math.abs(dx) > Math.abs(dy)
    }
    if (!start.sideways) return
    // Past either end the slide follows the finger at a third of its pace.
    const atEnd = (dx > 0 && index === 0) || (dx < 0 && index === last)
    setDrag(atEnd ? dx / 3 : dx)
  }

  const onPointerEnd = (event: PointerEvent) => {
    const start = swipe.current
    if (!start || start.pointerId !== event.pointerId) return
    swipe.current = null
    setDrag(null)
    if (event.type === 'pointercancel' || !start.sideways) return
    const dx = event.clientX - start.x
    const width = viewport.current?.offsetWidth ?? 0
    if (Math.abs(dx) >= width * SWIPE_SHARE) show(index + (dx < 0 ? 1 : -1))
  }

  const dragging = drag !== null
  return (
    <section
      aria-roledescription="carousel"
      aria-labelledby={labelledBy}
      className="@container flex w-full min-w-0 flex-col gap-4"
      onKeyDown={onKeyDown}
    >
      <div
        ref={viewport}
        // Wider than the column by a gutter each side, so a drawing's shadow and tilted corner
        // are not cut off at the column's edge.
        className="-mx-4 touch-pan-y overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div
          aria-live="polite"
          className={`flex ${dragging ? '' : 'transition-transform duration-(--dur-long) ease-(--ease)'}`}
          style={{ transform: `translateX(calc(${-index * 100}% + ${drag ?? 0}px))` }}
        >
          {WELCOME_SLIDES.map((slide, n) => {
            const current = n === index
            // A neighbor shows while a finger drags it in; otherwise only the current slide
            // shows, and one leaving stays drawn until it has slid out.
            const shown = current || (dragging && Math.abs(n - index) === 1)
            const Art = SLIDE_ART[slide.id]
            return (
              <div
                key={slide.id}
                role="group"
                aria-roledescription="slide"
                aria-label={slideLabel(n + 1)}
                inert={!current}
                className={`max-welcome:[@media(max-height:700px)]:gap-4 flex w-full shrink-0 flex-col items-stretch gap-6 px-4 ${
                  shown ? 'visible' : 'invisible transition-[visibility] duration-(--dur-long)'
                }`}
              >
                {/* Every drawing sits on one stage the column's width, so the slides read as a
                    set and the headline lines up with the stage's edges. */}
                <div
                  data-slide-stage
                  className="bg-surface max-welcome:[@media(max-height:700px)]:py-[8px] flex items-center justify-center overflow-hidden rounded-(--radius-surface) py-[14px]"
                >
                  <div className="[zoom:0.86]">
                    <Art />
                  </div>
                </div>
                <h1 className="t-screen-title m-0">{slide.headline}</h1>
              </div>
            )
          })}
        </div>
      </div>
      {/* Below the breakpoint the dots show by themselves, centered, and page by swipe; the arrows would
          not fit. Above it the row spans the stage, so the arrows end at its trailing edge. */}
      <div className="flex w-full items-center justify-center gap-2 @min-[416px]:justify-start">
        <div className="flex @min-[416px]:-ms-2">
          {WELCOME_SLIDES.map((slide, n) => (
            <button
              key={slide.id}
              ref={(dot) => {
                dots.current[n] = dot
              }}
              type="button"
              tabIndex={n === index ? 0 : -1}
              aria-label={slideDotLabel(n + 1)}
              aria-current={n === index ? 'true' : undefined}
              onClick={() => show(n)}
              className="group flex h-(--target-control) min-w-(--target-control) items-center justify-center rounded-full"
            >
              {/* The current dot is longer as well as darker, so it never reads by color alone. */}
              <span
                className={`h-2 rounded-full transition-[width,background-color] duration-(--dur-short) ease-(--ease) ${
                  n === index
                    ? 'bg-text-primary w-5'
                    : 'bg-text-secondary group-hover:bg-text-primary w-2'
                }`}
              />
            </button>
          ))}
        </div>
        {/* An arrow with no slide past it hides but keeps its place, so its neighbor never shifts. */}
        <div className="ms-auto hidden gap-2 @min-[416px]:flex">
          <span className={index === 0 ? 'invisible' : undefined}>
            <Button
              ref={previousRef}
              iconOnly
              variant="bordered"
              icon={ChevronLeft}
              label={PREVIOUS_SLIDE}
              onPress={() => show(index - 1)}
            />
          </span>
          <span className={index === last ? 'invisible' : undefined}>
            <Button
              ref={nextRef}
              iconOnly
              variant="bordered"
              icon={ChevronRight}
              label={NEXT_SLIDE}
              onPress={() => show(index + 1)}
            />
          </span>
        </div>
      </div>
    </section>
  )
}
