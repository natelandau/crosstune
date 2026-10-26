/** How long typing must pause before a search counts. */
export const SEARCH_DEBOUNCE_MS = 1000

export interface DebounceClock {
  /** Runs `run` after `ms`; the returned function cancels it. */
  after: (ms: number, run: () => void) => () => void
}

export const realDebounceClock: DebounceClock = {
  after: (ms, run) => {
    const id = setTimeout(run, ms)
    return () => clearTimeout(id)
  },
}

export interface DebouncedSearch {
  resultCount: number
  addedTypedTitle: boolean
}

export interface SearchDebouncer {
  /** The latest result count, or undefined while the results are loading. */
  setCount: (count: number | undefined) => void
  /** The query changed. A blank query ends the search; any other counts after a pause. */
  typed: (query: string) => void
  /** The search is done, so the debounced query is reported, `addedTypedTitle` if it made a tune. */
  finish: (addedTypedTitle?: boolean) => void
  /** Drops the pause timer without reporting. */
  dispose: () => void
}

/**
 * Decides when a search is worth reporting: a query counts once typing pauses, with the count
 * it showed then. A different query that counts reports the one before, and a search whose
 * query still counts when it ends is reported once.
 */
export function createSearchDebouncer(
  clock: DebounceClock,
  report: (search: DebouncedSearch) => void,
): SearchDebouncer {
  let query = ''
  let count: number | undefined
  let cancel: (() => void) | null = null
  let debounced: { query: string; count: number } | null = null
  // The pause ended while the results were still loading, so the query counts when the count arrives.
  let awaitingCount = false

  const stopTimer = () => {
    cancel?.()
    cancel = null
  }

  const reportDebounced = (addedTypedTitle: boolean) => {
    if (!debounced) return
    const { count: resultCount } = debounced
    debounced = null
    report({ resultCount, addedTypedTitle })
  }

  const debounce = () => {
    stopTimer()
    const text = query.trim()
    awaitingCount = text !== '' && count === undefined
    if (text === '' || count === undefined) return
    if (debounced && debounced.query !== text) reportDebounced(false)
    debounced = { query: text, count }
  }

  const finish = (addedTypedTitle = false) => {
    if (cancel !== null) debounce()
    awaitingCount = false
    reportDebounced(addedTypedTitle)
  }

  return {
    setCount: (next) => {
      count = next
      if (awaitingCount && next !== undefined) debounce()
    },
    typed: (next) => {
      query = next
      awaitingCount = false
      stopTimer()
      if (next.trim() === '') {
        finish()
        return
      }
      cancel = clock.after(SEARCH_DEBOUNCE_MS, debounce)
    },
    finish,
    dispose: () => {
      awaitingCount = false
      stopTimer()
    },
  }
}
