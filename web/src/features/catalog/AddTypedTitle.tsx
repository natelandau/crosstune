import { Plus } from 'lucide-react'
import { Link } from 'react-router'
import { OPEN, addTypedTitleLabel, hiddenMatchText, openTuneName } from './catalogCopy'
import type { SearchOutcome } from './searchIntent'
import { destination } from '../../layout/destinations'
import { PressableRow } from '../../ui/PressableRow'

const CATALOG = destination('catalog')

/** The row under the results that adds the typed title as a new tune. */
export function AddTypedTitle({
  outcome,
  onCreate,
}: {
  outcome: SearchOutcome
  onCreate: (title: string) => void
}) {
  if (outcome.kind !== 'create') return null
  return (
    <div className="px-2">
      <PressableRow variant="list" onPress={() => onCreate(outcome.title)}>
        <Plus className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{addTypedTitleLabel(outcome)}</span>
      </PressableRow>
    </div>
  )
}

/** Names an exact match that a filter or the archived setting hides, with a way to open it. */
export function HiddenMatch({
  outcome,
  onOpen,
}: {
  outcome: SearchOutcome
  onOpen: (tuneId: string) => void
}) {
  if (outcome.kind !== 'create' || !outcome.hidden) return null
  const { entry } = outcome.hidden
  return (
    <p className="t-secondary text-secondary px-4 py-2">
      {hiddenMatchText(outcome.hidden)}{' '}
      <Link
        to={`${CATALOG.root}/${entry.tune.id}`}
        aria-label={openTuneName(entry.tune.title)}
        className="text-primary -my-3 inline-flex min-h-(--target) min-w-(--target) items-center justify-center"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
          event.preventDefault()
          onOpen(entry.tune.id)
        }}
      >
        {OPEN}
      </Link>
    </p>
  )
}
