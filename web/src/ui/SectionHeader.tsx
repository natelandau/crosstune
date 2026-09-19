import type { ReactNode } from 'react'

/** A group header above an inset list: footnote role, sentence case, in the secondary color. */
export function SectionHeader({ children }: { children: ReactNode }) {
  return <h2 className="type-footnote m-0 px-5 pt-5 pb-1.5">{children}</h2>
}
