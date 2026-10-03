import { Pin } from 'lucide-react'
import { PLAYS_FIRST } from './playSourceText'

/** Marks the row a list plays for its tune. */
export function PinnedMark() {
  return (
    <span role="img" aria-label={PLAYS_FIRST} className="shrink-0">
      <Pin aria-hidden="true" className="size-4" />
    </span>
  )
}
