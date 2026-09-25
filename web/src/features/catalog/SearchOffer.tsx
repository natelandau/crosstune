import { IonItem, IonLabel } from '@ionic/react'
import { Plus } from 'lucide-react'
import type { SearchOutcome } from './searchIntent'

/** The row that adds the typed title, placed as the last row of the results. */
export function SearchOfferRow({
  outcome,
  onCreate,
}: {
  outcome: SearchOutcome
  onCreate: (title: string) => void
}) {
  if (outcome.kind !== 'create') return null
  return (
    <IonItem button detail={false} lines="none" onClick={() => onCreate(outcome.title)}>
      <Plus aria-hidden="true" slot="start" className="size-6 text-(--ion-color-primary)" />
      <IonLabel color="primary">{offerLabel(outcome)}</IonLabel>
    </IonItem>
  )
}

function offerLabel(outcome: Extract<SearchOutcome, { kind: 'create' }>): string {
  return outcome.another ? `Add another "${outcome.title}"` : `Add "${outcome.title}"`
}

/** Names an exact match that search found but a filter or the archived setting hides. */
export function HiddenMatchNote({
  outcome,
  onOpen,
}: {
  outcome: SearchOutcome
  onOpen: (tuneId: string) => void
}) {
  if (outcome.kind !== 'create' || !outcome.hidden) return null
  const { entry, reason } = outcome.hidden
  return (
    <p className="type-footnote px-5 pt-2">
      <span>{`"${entry.tune.title}" is ${reason === 'archived' ? 'archived' : 'hidden by your filters'}.`}</span>{' '}
      <a
        href={`/catalog/${entry.tune.id}`}
        className="-my-3 inline-flex min-h-11 min-w-11 items-center justify-center text-(--ion-color-primary)"
        aria-label={`Open ${entry.tune.title}`}
        onClick={(event) => {
          event.preventDefault()
          onOpen(entry.tune.id)
        }}
      >
        Open
      </a>
    </p>
  )
}
