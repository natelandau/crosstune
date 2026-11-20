import { useStampedDensity } from '../../platform/density'

/** A Settings row's value at its trailing edge, such as a category's summary. */
export function RowSummary({ children }: { children: string }) {
  const touch = useStampedDensity() === 'touch'
  return (
    // On pointer the row's trailing slot holds the cap, so a percentage here would take half of
    // a width the text itself sets.
    <span
      className={`t-body text-secondary min-w-0 truncate pe-1 ${touch ? 'max-w-1/2 shrink-0' : ''}`}
    >
      {children}
    </span>
  )
}
