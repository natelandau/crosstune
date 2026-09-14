import { Link } from '@tanstack/react-router'
import type { SearchOutcome } from './searchIntent'

/**
 * The search box's offer beyond its results: an add link for the query, preceded by a pointer to
 * a song that matches exactly but is hidden. `list` sits under the cards; `empty` is an action.
 */
export function SearchSuggestion({
  outcome,
  placement,
}: {
  outcome: SearchOutcome
  placement: 'list' | 'empty'
}) {
  if (outcome.kind !== 'create') return null

  const label = outcome.another ? `Add another "${outcome.title}"` : `Add "${outcome.title}"`
  const hidden = outcome.hidden
  return (
    <>
      {hidden ? (
        <p className={`text-sm ${placement === 'list' ? 'px-3' : ''}`}>
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
      {placement === 'list' ? (
        <Link
          to="/songs/new"
          search={{ title: outcome.title }}
          className="rounded-box border-base-content/20 flex min-h-16 items-center gap-3 border-2 border-dashed px-3 py-2 active:opacity-80"
        >
          <span aria-hidden="true" className="w-14 shrink-0 text-center text-2xl">
            +
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        </Link>
      ) : (
        <Link
          to="/songs/new"
          search={{ title: outcome.title }}
          className={`btn btn-sm ${hidden ? 'btn-ghost' : 'btn-primary'}`}
        >
          {label}
        </Link>
      )}
    </>
  )
}
