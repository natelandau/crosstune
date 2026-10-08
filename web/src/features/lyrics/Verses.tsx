import type { ReactNode } from 'react'

/**
 * Lyrics as verses of lines, at the reader's size step. A line break in a tune is meaning, so
 * each line is its own block with a hanging indent: a wrap sits under its line and a new line
 * starts at the margin.
 */
export function Verses({
  verses,
  step,
  className = '',
  children,
}: {
  verses: readonly (readonly string[])[]
  /** The reader's size step from `lyricsSize`, 1 to `LYRICS_STEPS`. */
  step: number
  className?: string
  /** Set after the verses inside their measure, so it lines up with the words at every size. */
  children?: ReactNode
}) {
  return (
    <div data-lyrics-size={step} className={`t-lyrics text-ink select-text ${className}`}>
      {verses.map((lines, verse) => (
        <div key={verse} data-verse className="[&+&]:mt-[0.9em]">
          {lines.map((line, index) => (
            <p key={index} className="m-0 pl-[1.25ch] -indent-[1.25ch]">
              {line}
            </p>
          ))}
        </div>
      ))}
      {children}
    </div>
  )
}
