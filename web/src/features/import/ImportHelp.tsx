import { CircleHelp } from 'lucide-react'
import { IMPORT_HELP_URL, WHAT_CAN_I_PASTE } from './importCopy'

/** "What can I paste?", which opens the public help page so the rules live in one place. */
export function ImportHelp() {
  return (
    <a
      href={IMPORT_HELP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="t-body text-action inline-flex min-h-(--target-control) items-center gap-2 px-4 pt-2"
    >
      <CircleHelp className="size-4 shrink-0" aria-hidden />
      {WHAT_CAN_I_PASTE}
    </a>
  )
}
