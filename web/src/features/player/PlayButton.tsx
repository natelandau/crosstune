/** A solid play triangle, nudged right: centered, it looks off-center against its own leading edge. */
export function PlayGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="ml-0.5 size-5 shrink-0 fill-current">
      <path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" />
    </svg>
  )
}

export function StopGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 fill-current">
      <rect x="5" y="5" width="14" height="14" rx="1.5" />
    </svg>
  )
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
