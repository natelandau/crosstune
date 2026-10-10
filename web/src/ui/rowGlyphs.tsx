import { CircleSlash } from 'lucide-react'
import type { ReactNode } from 'react'

/** The slot before a row's title, sized to the row's touch target whatever it holds. */
export function Slot({ children }: { children?: ReactNode }) {
  return <span className="flex size-11 shrink-0 items-center justify-center">{children}</span>
}

// A bare triangle at a row's edge reads as a disclosure arrow, so a row's transport glyph sits
// in a disc: tinted while idle, solid once it holds what plays.
const DISC =
  'grid size-7 shrink-0 place-items-center rounded-full transition-[background-color,color,scale] duration-(--dur-short) ease-(--ease) in-[html[data-density=pointer]]:size-6'
const IDLE = 'bg-tint text-action'
const LOADED = 'bg-accent text-on-accent'

/** For a control holding a disc: the disc fills while the pointer is over the control. */
export const DISC_HOVER =
  'hover:[&_[data-transport-disc]]:bg-accent hover:[&_[data-transport-disc]]:text-on-accent'
/** For a row that is itself the control: the disc fills while the pointer is over the row. */
export const DISC_ROW_HOVER =
  'group-hover:[&_[data-transport-disc]]:bg-accent group-hover:[&_[data-transport-disc]]:text-on-accent'

function Disc({ loaded, children }: { loaded: boolean; children: ReactNode }) {
  return (
    <span aria-hidden="true" data-transport-disc className={`${DISC} ${loaded ? LOADED : IDLE}`}>
      {children}
    </span>
  )
}

export type TransportShape = 'play' | 'stop' | 'pause'

/**
 * Play, stop, or pause as one shape, so a change between them morphs rather than swaps. Play
 * sits right of center in its box, so no caller nudges it.
 */
export function TransportMark({ shape, className }: { shape: TransportShape; className: string }) {
  return <span aria-hidden data-shape={shape} className={`transport shrink-0 ${className}`} />
}

/**
 * A row's transport glyph in a disc. One element for every shape, so a change between play,
 * stop, and pause morphs rather than swaps. A row can only unload the player, so its loaded
 * state reads as stop, not pause. The disc is solid while it holds what plays.
 */
export function TransportGlyph({
  shape,
  loaded = shape !== 'play',
}: {
  shape: TransportShape
  loaded?: boolean
}) {
  return (
    <Disc loaded={loaded}>
      <TransportMark shape={shape} className="size-3.5" />
    </Disc>
  )
}

/** Stands where a play control would be, for a tune with nothing to play. */
export function NotPlayableGlyph() {
  return <CircleSlash aria-hidden="true" className="size-5 shrink-0 opacity-60" />
}
