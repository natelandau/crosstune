import { Check } from 'lucide-react'

/** The check that marks a row as the current choice of a single-choice list; iOS draws `SelectionMark(.single)`. */
export function ChosenMark() {
  return <Check className="text-accent size-5 shrink-0" aria-hidden />
}
