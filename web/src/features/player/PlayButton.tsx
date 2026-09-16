import { Play, Square } from 'lucide-react'

/** A solid play triangle, nudged right: centered, it looks off-center against its own leading edge. */
export function PlayGlyph() {
  return <Play aria-hidden="true" fill="currentColor" className="ml-0.5 size-5 shrink-0" />
}

export function StopGlyph() {
  return <Square aria-hidden="true" fill="currentColor" className="size-4 shrink-0" />
}

/**
 * The row control for anything the player can hold: a bare play glyph, or a stop glyph while
 * this item is the one loaded, on the same ghost square the other row controls use. Closing is
 * the only way to unload, so the loaded state reads as stop rather than pause; pausing belongs
 * to the player itself.
 */
export function PlayButton({
  title,
  loaded,
  onPlay,
  onClose,
  playDisabled = false,
}: {
  title: string
  loaded: boolean
  onPlay: () => void
  onClose: () => void
  /** Play is refused but stays focusable, so a row keeps its control while offline. */
  playDisabled?: boolean
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-square min-h-11 min-w-11 shrink-0"
      onClick={() => {
        if (loaded) onClose()
        else if (!playDisabled) onPlay()
      }}
      aria-disabled={!loaded && playDisabled ? true : undefined}
      aria-label={loaded ? `Close ${title} player` : `Play ${title}`}
    >
      {loaded ? <StopGlyph /> : <PlayGlyph />}
    </button>
  )
}
