import type { ReactNode } from 'react'

/**
 * A group header above an inset list: footnote role, sentence case, in the secondary color. It
 * sits at the text inset rather than the card edge, so it lines up with the row labels under
 * it. The space above it belongs to the section, which is what makes a header read as part of
 * the group it names rather than as a line adrift between two of them.
 */
export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h2 className="type-footnote m-0 px-(--form-inset) pt-0 pb-(--form-text-gap)">{children}</h2>
  )
}
