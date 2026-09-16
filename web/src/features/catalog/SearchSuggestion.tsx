import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { SearchOutcome } from './searchIntent'

const LIST_CLASS =
  'rounded-box border-base-content/20 flex min-h-16 w-full items-center gap-3 border-2 border-dashed px-3 py-2 text-left active:opacity-80'

/**
 * The search box's offer beyond its results: an add link for the query, preceded by a pointer to
 * a song that matches exactly but is hidden. `list` sits under the cards; `empty` is an action.
 * With `onCreate`, the offer is a button that hands the title to the caller instead of a link
 * to the new-song screen, for a host that must do its own work before leaving.
 */
export function SearchSuggestion({
  outcome,
  placement,
  onCreate,
}: {
  outcome: SearchOutcome
  placement: 'list' | 'empty'
  onCreate?: (title: string) => void
}) {
  if (outcome.kind !== 'create') return null

  const label = outcome.another ? `Add another "${outcome.title}"` : `Add "${outcome.title}"`
  const hidden = outcome.hidden
  const className =
    placement === 'list' ? LIST_CLASS : `btn btn-sm ${hidden ? 'btn-ghost' : 'btn-primary'}`
  const body =
    placement === 'list' ? (
      <>
        <span className="flex w-14 shrink-0 justify-center">
          <Plus aria-hidden="true" className="size-6" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      </>
    ) : (
      label
    )
  return (
    <>
      {hidden ? (
        <p className={`text-meta ${placement === 'list' ? 'px-3' : ''}`}>
          <span>
            "{hidden.entry.song.title}" is{' '}
            {hidden.reason === 'archived' ? 'archived' : 'hidden by your filters'}.
          </span>{' '}
          <Link
            to="/songs/$id"
            params={{ id: hidden.entry.song.id }}
            className="link link-primary"
            aria-label={`Open ${hidden.entry.song.title}`}
          >
            Open
          </Link>
        </p>
      ) : null}
      {onCreate ? (
        <button type="button" className={className} onClick={() => onCreate(outcome.title)}>
          {body}
        </button>
      ) : (
        <Link to="/songs/new" search={{ title: outcome.title }} className={className}>
          {body}
        </Link>
      )}
    </>
  )
}
