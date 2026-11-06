import { ArrowUpRight, CloudDownload, Volume2 } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Button as AriaButton } from 'react-aria-components'

// Every glyph in the slot takes this box, so a row's state change never moves its layout.
const GLYPH_BOX = 'size-6 shrink-0 in-[html[data-density=pointer]]:size-5'
// A bare triangle at a row's edge reads as a disclosure arrow, so a row's glyph sits in a ring.
const RING = `grid ${GLYPH_BOX} place-items-center rounded-full border-[1.5px] border-current`
// Strokes that ignore the icon's scale, so an icon draws the ring's 1.5px line at any size.
const ICON_STROKE = 1.5
const ICON =
  'size-3.5 in-[html[data-density=pointer]]:size-3 [&_*]:[vector-effect:non-scaling-stroke]'

// A full tap target that takes only its glyph's height in the layout, so the row's text sets
// the row's height and the target reaches into the row's padding.
const SLOT_BOX =
  'grid h-(--target-control) shrink-0 place-items-center -my-2.5 in-[html[data-density=pointer]]:-my-1'

const ACTION_SLOT = `${SLOT_BOX} w-(--target-control)`
const WORDED_SLOT = `${SLOT_BOX} min-w-(--target-control)`

/** For a control holding a ring: the ring fills while the pointer is over the control. */
const RING_HOVER =
  'hover:[&_[data-row-ring]]:border-accent-fill hover:[&_[data-row-ring]]:bg-accent-fill hover:[&_[data-row-ring]]:text-on-accent-fill'
/** For a row that is itself the control: the ring fills while the pointer is over the row. */
export const RING_ROW_HOVER =
  'group-hover:[&_[data-row-ring]]:border-accent-fill group-hover:[&_[data-row-ring]]:bg-accent-fill group-hover:[&_[data-row-ring]]:text-on-accent-fill'

/**
 * A row's trailing action slot around its content; empty, it holds the column. `worded` widens
 * it to fit a control with a word for its label.
 */
export function ActionSlot({
  worded = false,
  className = '',
  ...props
}: ComponentProps<'span'> & { worded?: boolean }) {
  return <span {...props} className={`${worded ? WORDED_SLOT : ACTION_SLOT} ${className}`} />
}

/** A control that fills a row's action slot, around a glyph. */
export function SlotButton({
  name,
  onPress,
  isDisabled = false,
  children,
}: {
  name: string
  onPress: () => void
  isDisabled?: boolean
  children: ReactNode
}) {
  return (
    <AriaButton
      aria-label={name}
      isDisabled={isDisabled}
      onPress={onPress}
      className={`${ACTION_SLOT} rounded-full transition-[scale,opacity] duration-(--dur-short) ease-(--ease) data-[disabled]:opacity-40 data-[pressed]:scale-90 ${isDisabled ? '' : RING_HOVER}`}
    >
      {children}
    </AriaButton>
  )
}

function Ring({ className = '', ...props }: ComponentProps<'span'>) {
  return <span {...props} aria-hidden="true" className={`${RING} ${className}`} />
}

/** A ring the pointer's hover fill reaches, for a glyph that stands for a control. */
function ControlRing({ className = '', ...props }: ComponentProps<'span'>) {
  return (
    <Ring
      {...props}
      data-row-ring
      className={`transition-[background-color,border-color,color] duration-(--dur-short) ease-(--ease) ${className}`}
    />
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
 * A row's transport glyph in a ring. One element for every shape, so a change between play
 * and stop morphs rather than swaps. A row can only unload the player, so its loaded
 * state reads as stop, not pause. The ring stays unfilled, so a loaded row never looks like
 * the pointer's hover fill.
 */
export function TransportGlyph({
  shape,
  tone = 'primary',
}: {
  shape: 'play' | 'stop'
  /** Accent for play in a list that is playing but paused. */
  tone?: 'primary' | 'accent'
}) {
  return (
    <ControlRing className={tone === 'accent' ? 'text-accent' : 'text-primary'}>
      <TransportMark shape={shape} className="size-2.5" />
    </ControlRing>
  )
}

/** The playing list or tune. It pulses while it sounds. */
export function NowPlayingGlyph() {
  return (
    <ControlRing className="text-accent" data-playing-glyph>
      <Volume2
        aria-hidden="true"
        strokeWidth={ICON_STROKE}
        className={`${ICON} motion-safe:animate-pulse`}
      />
    </ControlRing>
  )
}

/** A recording that can be downloaded to this device: a cloud in the ring's box, with no ring. */
export function DownloadGlyph({
  dimmed = false,
}: {
  /** In tertiary text, for a download offered while offline. */
  dimmed?: boolean
}) {
  return (
    <CloudDownload
      aria-hidden="true"
      strokeWidth={ICON_STROKE}
      className={`${GLYPH_BOX} ${dimmed ? 'text-tertiary' : 'text-primary'}`}
    />
  )
}

/** A link that opens on its provider's own site. */
export function LinkOutGlyph() {
  return (
    <ControlRing className="text-primary">
      <ArrowUpRight aria-hidden="true" strokeWidth={ICON_STROKE} className={ICON} />
    </ControlRing>
  )
}

/**
 * A recording on its way to this device: a spinning arc on the ring, around a stop square.
 * Under reduced motion the arc is hidden, since a still arc reads as a progress value.
 */
export function DownloadingGlyph() {
  return (
    <Ring className="text-secondary relative">
      <span
        data-downloading-arc
        className="text-primary absolute -inset-[1.5px] rounded-full border-[1.5px] border-transparent border-t-current motion-safe:animate-spin motion-reduce:hidden"
      />
      <TransportMark shape="stop" className="text-primary size-2" />
    </Ring>
  )
}

/** The glyph for a recording row's control, or none for a row with nothing to do. */
export function RecordingControlGlyph({
  control,
  offline,
}: {
  control: 'play' | 'close' | 'download' | 'downloading' | 'none'
  /** A download offered while offline. */
  offline: boolean
}) {
  if (control === 'close' || control === 'play') {
    return <TransportGlyph shape={control === 'close' ? 'stop' : 'play'} />
  }
  if (control === 'download') return <DownloadGlyph dimmed={offline} />
  if (control === 'downloading') return <DownloadingGlyph />
  return null
}

/** The glyph for a link row's control, or none for a row with nothing to do. */
export function LinkControlGlyph({ control }: { control: 'play' | 'close' | 'open' | 'none' }) {
  if (control === 'close' || control === 'play') {
    return <TransportGlyph shape={control === 'close' ? 'stop' : 'play'} />
  }
  if (control === 'open') return <LinkOutGlyph />
  return null
}
