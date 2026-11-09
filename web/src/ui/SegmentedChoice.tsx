import { motion, useReducedMotionConfig } from 'motion/react'
import {
  useLayoutEffect,
  useMemo,
  useState,
  type Dispatch,
  type Ref,
  type SetStateAction,
} from 'react'
import { mergeRefs } from 'react-aria'
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components'
import { SPRING } from '../theme/motion'
import { SIZE_CLASS, useControlSize } from './inRow'
import { PRESS } from './press'
import { TAP_AREA } from './tapArea'
import { useLatest } from './useLatest'

interface Fit {
  x: number
  width: number
}

/** The track a row of segments sits on. */
const SEGMENTED_TRACK = 'bg-field relative rounded-(--radius) p-0.5'

/** The pill behind the chosen segment, placed by the component. */
const PILL_CLASS =
  'bg-page pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded-(--radius-inner) shadow-(--shadow-control)'

/** A segment: secondary until chosen, which also sets it in medium weight. */
const SEGMENT_BUTTON =
  'text-secondary hover:text-primary data-[selected]:text-primary relative z-10 flex items-center justify-center rounded-(--radius-inner) data-[selected]:font-medium'

function measureFit(track: HTMLElement, setFit: Dispatch<SetStateAction<Fit | null>>) {
  const chosen = track.querySelector<HTMLElement>('[data-selected]')
  setFit((current) => {
    if (!chosen) return null
    const next = { x: chosen.offsetLeft, width: chosen.offsetWidth }
    return current?.x === next.x && current.width === next.width ? current : next
  })
}

/**
 * One of `segments`, chosen from a row of labels on a track, with a pill that slides to the
 * chosen one. `selected` may be null when the value matches none of them.
 */
export function SegmentedChoice<T extends string>({
  ref,
  label,
  segments,
  selected,
  onChange,
  fill = false,
  ...data
}: {
  ref?: Ref<HTMLDivElement>
  label: string
  segments: readonly { id: T; label: string }[]
  selected: T | null
  onChange: (next: T) => void
  /** Equal widths across the whole row, rather than each segment fitting its label. */
  fill?: boolean
} & { [attribute: `data-${string}`]: boolean | undefined }) {
  const size = useControlSize()
  const [track, setTrack] = useState<HTMLDivElement | null>(null)
  const [fit, setFit] = useState<Fit | null>(null)
  const ids = segments.map((segment) => segment.id).join('|')

  useLayoutEffect(() => {
    if (!track) return
    const observer = new ResizeObserver(() => measureFit(track, setFit))
    observer.observe(track)
    for (const button of track.querySelectorAll('button, [role=radio]')) observer.observe(button)
    return () => observer.disconnect()
  }, [track, ids])

  useLayoutEffect(() => {
    if (track) measureFit(track, setFit)
  }, [track, selected, ids])

  const reduceMotion = useReducedMotionConfig() ?? false
  // Holds the choice last sent until the next render, so a click that also moves focus sends
  // it once.
  const sentRef = useLatest<T | null>(selected)
  const choose = (next: T) => {
    if (next === sentRef.current) return
    sentRef.current = next
    onChange(next)
  }

  const setRef = useMemo(() => mergeRefs<HTMLDivElement>(setTrack, ref), [ref])

  return (
    <ToggleButtonGroup
      ref={setRef}
      {...data}
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={selected === null ? [] : [selected]}
      onSelectionChange={(keys) => {
        const next = segments.find((segment) => keys.has(segment.id))
        if (next) choose(next.id)
      }}
      className={`${SEGMENTED_TRACK} ${SIZE_CLASS[size].h} ${fill ? 'flex w-full' : 'inline-flex'}`}
    >
      {fit && (
        <motion.span
          data-segment-pill
          aria-hidden
          initial={false}
          animate={{ x: fit.x, width: fit.width }}
          transition={reduceMotion ? { duration: 0 } : SPRING}
          className={PILL_CLASS}
        />
      )}
      {segments.map((segment) => (
        <ToggleButton
          key={segment.id}
          id={segment.id}
          // Focus arriving from a sibling is an arrow key: the choice follows it, as in a radio group.
          onFocus={(event) => {
            if (track?.contains(event.relatedTarget as Node | null)) choose(segment.id)
          }}
          className={`${SEGMENT_BUTTON} ${size === 'compact' ? 'text-[0.875rem] in-data-[density=pointer]:text-[0.78125rem]' : 'text-[0.9375rem] in-data-[density=pointer]:text-[0.8125rem]'} ${fill ? 'flex-1' : 'flex-none px-4'} ${TAP_AREA} ${PRESS}`}
        >
          {segment.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
