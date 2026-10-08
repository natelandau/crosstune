import { RECORDED_HEADER, recordedLine } from '../copy'
import { equivalenceText } from '../equivalences'
import type { Equivalence, Recorded as RecordedData } from '../types'
import { PageSection } from '../../tune/PageSection'

/** Always shown. The comparison under the total appears only when the total earns one. */
export function Recorded({
  recorded,
  equivalence,
  tuneTitles,
}: {
  recorded: RecordedData
  equivalence: Equivalence | null
  tuneTitles: ReadonlyMap<string, string>
}) {
  const comparison = equivalence
    ? equivalenceText(
        equivalence,
        equivalence.tune_id ? tuneTitles.get(equivalence.tune_id) : undefined,
      )
    : undefined
  return (
    <PageSection title={RECORDED_HEADER}>
      <p className="t-body t-num">{recordedLine(recorded.count, recorded.total_ms)}</p>
      {comparison && <p className="t-secondary text-ink-2 pt-1">{comparison}</p>}
    </PageSection>
  )
}
