/**
 * The drawn part of a range edge: a line down the waveform and a grip tab beside it, in
 * `--loop-handle`. Its parent is the 44 px target and sets the color slot.
 */
export function LoopHandleMark({ edge }: { edge: 'start' | 'end' }) {
  return (
    <>
      <span className="h-full w-0.5 bg-(--loop-handle)" />
      {/* The tab sits outside the range so it never covers the audio in it. */}
      <span
        data-grip
        className={`absolute top-1/2 flex h-11 w-4 -translate-y-1/2 items-center justify-center gap-0.5 bg-(--loop-handle) ${edge === 'start' ? 'right-1/2 rounded-l-md' : 'left-1/2 rounded-r-md'}`}
      >
        <span className="bg-on-practice h-4 w-px" />
        <span className="bg-on-practice h-4 w-px" />
      </span>
    </>
  )
}
