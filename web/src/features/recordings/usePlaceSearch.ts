import { useEffect, useRef, useState } from 'react'
import type { PlaceHint, PlaceResult } from '../../api/types'
import { useSyncEngine } from '../../sync/SyncProvider'
import type { PlaceSearchOutcome } from '../../sync/types'
import { useSettled } from '../../ui/useSettled'
import {
  LOCATION_SEARCH_OFFLINE,
  LOCATION_SEARCH_UNAVAILABLE,
  locationSearchBusy,
  NO_LOCATIONS_FOUND,
} from './recordingsCopy'

const NO_RESULTS: PlaceResult[] = []

// The search endpoint's shortest text.
const MIN_QUERY = 2

function outcomeMessage(outcome: PlaceSearchOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return NO_LOCATIONS_FOUND
    case 'offline':
      return LOCATION_SEARCH_OFFLINE
    case 'rate_limited':
      return locationSearchBusy(outcome.retryAfterSeconds)
    default:
      return LOCATION_SEARCH_UNAVAILABLE
  }
}

export interface PlaceSearchState {
  /** The answer's results for the text as typed now; none while its search is out. */
  results: PlaceResult[]
  /** Why the answered search shows no results, or null. */
  message: string | null
  /**
   * Where the latest answered search's results are, its first result's point. Null once the text
   * is cleared or an answer has no results; a search still out leaves the last one standing.
   */
  area: PlaceHint | null
}

/**
 * A place search for `query`: two or more characters search once the typing has settled, ranked
 * near `near`, and only the latest search's answer shows.
 */
export function usePlaceSearch(query: string, near: PlaceHint | null): PlaceSearchState {
  const engine = useSyncEngine()
  const [answer, setAnswer] = useState<{ term: string; outcome: PlaceSearchOutcome } | null>(null)
  const latestAsk = useRef(0)
  const trimmed = query.trim()
  const term = trimmed.length >= MIN_QUERY ? trimmed : null
  const nearLat = near?.lat
  const nearLon = near?.lon
  if (term === null && answer !== null) setAnswer(null)
  const settled = useSettled(term === null ? null : `${term}\n${nearLat},${nearLon}`)

  useEffect(() => {
    // Every change of term or hint retires the search before it, so a slow answer never shows late.
    const ask = ++latestAsk.current
    if (settled === null || term === null) return
    const hint =
      nearLat === undefined || nearLon === undefined ? undefined : { lat: nearLat, lon: nearLon }
    void engine
      .searchPlaces(term, hint)
      .catch((): PlaceSearchOutcome => ({ kind: 'failed' }))
      .then((outcome) => {
        if (ask === latestAsk.current) setAnswer({ term, outcome })
      })
  }, [engine, settled, term, nearLat, nearLon])

  const outcome = term !== null && answer?.term === term ? answer.outcome : undefined
  const results = outcome?.kind === 'ok' ? outcome.results : NO_RESULTS
  const first = answer?.outcome.kind === 'ok' ? answer.outcome.results[0] : undefined
  return {
    results,
    message: outcome && results.length === 0 ? outcomeMessage(outcome) : null,
    area: first ? { lat: first.lat, lon: first.lon } : null,
  }
}
