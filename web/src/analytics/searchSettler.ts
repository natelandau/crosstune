/** How long typing must pause before a search counts as settled. */
export const SEARCH_SETTLE_MS = 1000

export interface SettleClock {
  /** Runs `run` after `ms`; the returned function cancels it. */
  after: (ms: number, run: () => void) => () => void
}

export const realSettleClock: SettleClock = {
  after: (ms, run) => {
    const id = setTimeout(run, ms)
    return () => clearTimeout(id)
  },
}

export interface SettledSearch {
  resultCount: number
  tookOffer: boolean
}

export interface SearchSettler {
  /** The latest result count, or undefined while the results are loading. */
  setCount: (count: number | undefined) => void
  /** The query changed. A blank query ends the search; any other settles after a pause. */
  typed: (query: string) => void
  /** The search is done with, so the settled query is reported, `tookOffer` when it led to a new tune. */
  finish: (tookOffer?: boolean) => void
  /** Drops the pause timer without reporting. */
  dispose: () => void
}

/**
 * Decides when a search is worth reporting: a query settles once typing pauses, with the count
 * it showed then. A different query settles over the one before and reports it, and a search
 * still settled when it ends is reported once.
 */
export function createSearchSettler(
  clock: SettleClock,
  report: (search: SettledSearch) => void,
): SearchSettler {
  let query = ''
  let count: number | undefined
  let cancel: (() => void) | null = null
  let settled: { query: string; count: number } | null = null
  // The pause ended while the results were still loading, so the count settles when it arrives.
  let awaitingCount = false

  const stopTimer = () => {
    cancel?.()
    cancel = null
  }

  const reportSettled = (tookOffer: boolean) => {
    if (!settled) return
    const { count: resultCount } = settled
    settled = null
    report({ resultCount, tookOffer })
  }

  const settle = () => {
    stopTimer()
    const text = query.trim()
    awaitingCount = text !== '' && count === undefined
    if (text === '' || count === undefined) return
    if (settled && settled.query !== text) reportSettled(false)
    settled = { query: text, count }
  }

  const finish = (tookOffer = false) => {
    if (cancel !== null) settle()
    awaitingCount = false
    reportSettled(tookOffer)
  }

  return {
    setCount: (next) => {
      count = next
      if (awaitingCount && next !== undefined) settle()
    },
    typed: (next) => {
      query = next
      awaitingCount = false
      stopTimer()
      if (next.trim() === '') {
        finish()
        return
      }
      cancel = clock.after(SEARCH_SETTLE_MS, settle)
    },
    finish,
    dispose: () => {
      awaitingCount = false
      stopTimer()
    },
  }
}
