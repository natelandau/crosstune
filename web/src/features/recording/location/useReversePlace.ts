import { useEffect, useRef, useState } from 'react'
import type { PlaceHint } from '../../../api/types'
import { useSyncEngine } from '../../../sync/SyncProvider'
import type { PlaceReverseOutcome } from '../../../sync/types'
import { useSettled } from '../../../ui/useSettled'

/** The answers a lookup gives for good, kept by point, so a point looked up once is not again. */
export type ReverseAnswers = Map<string, PlaceReverseOutcome>

/** An answer that would not change if asked again, unlike being offline or refused for now. */
const lasting = (outcome: PlaceReverseOutcome) =>
  outcome.kind === 'ok' || outcome.kind === 'not_found'

/**
 * The place at `point`, asked once the point has held still, unless `known` holds it. Null while
 * there is no point or its answer has not come; only the latest point's answer shows.
 */
export function useReversePlace(
  point: PlaceHint | null,
  known: ReverseAnswers,
): PlaceReverseOutcome | null {
  const engine = useSyncEngine()
  const [answer, setAnswer] = useState<{ key: string; outcome: PlaceReverseOutcome } | null>(null)
  const latestAsk = useRef(0)
  const key = point ? `${point.lat},${point.lon}` : null
  const kept = key === null ? undefined : known.get(key)
  const settled = useSettled(kept === undefined ? key : null)
  const lat = point?.lat
  const lon = point?.lon

  useEffect(() => {
    // Every move retires the lookup before it, so a slow answer never names a spot left behind.
    const ask = ++latestAsk.current
    if (settled === null || lat === undefined || lon === undefined) return
    void engine
      .reversePlace(lat, lon)
      .catch((): PlaceReverseOutcome => ({ kind: 'failed' }))
      .then((outcome) => {
        if (lasting(outcome)) known.set(settled, outcome)
        if (ask === latestAsk.current) setAnswer({ key: settled, outcome })
      })
  }, [engine, known, settled, lat, lon])

  if (kept) return kept
  return key !== null && answer?.key === key ? answer.outcome : null
}
