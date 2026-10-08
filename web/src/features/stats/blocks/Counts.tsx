import { Button as AriaButton } from 'react-aria-components'
import { STATUSES, type TuneStatus } from '../../../api/vocabulary'
import { STATUS_LABELS } from '../../../constants'
import { archivedLine, COUNTS_HEADER, tallyLine, TUNES_LABEL, valueLabel } from '../copy'
import type { Counts as CountsData } from '../types'
import { PageSection } from '../../tune/PageSection'
import { ErrorLine } from '../../../ui/ErrorLine'
import { StatusGlyph } from '../../../ui/StatusGlyph'
import { StatusSplitBar } from '../../../ui/StatusSplitBar'
import { PRESS } from './press'

/**
 * The tune total, one bar split by status with each status's count under it, and the tally.
 * Always shown, at zero too. Archived tunes count only in the quiet line under it.
 */
export function Counts({
  counts,
  onStatus,
  error,
}: {
  counts: CountsData
  onStatus: (status: TuneStatus) => void
  error: string | null
}) {
  const byStatus: Record<TuneStatus, number> = {
    known: counts.known,
    learning: counts.learning,
    want_to_learn: counts.want_to_learn,
  }
  return (
    <PageSection title={COUNTS_HEADER}>
      <p className="flex items-baseline gap-2">
        <span className="t-page-title t-num">{counts.tunes.toLocaleString('en-US')}</span>
        <span className="t-body text-ink-2">{TUNES_LABEL}</span>
      </p>
      {/* The rows under it say each count, so the bar would say them twice. */}
      <StatusSplitBar byStatus={byStatus} className="mt-3 h-2" />
      <ul className="mt-2 flex flex-wrap gap-x-4">
        {STATUSES.map((status) => (
          <li key={status}>
            <AriaButton
              aria-label={valueLabel(STATUS_LABELS[status], byStatus[status])}
              onPress={() => onStatus(status)}
              className={`flex min-h-(--target) items-center gap-2 ${PRESS}`}
            >
              <StatusGlyph status={status} labelled />
              <span className="t-body t-num">{byStatus[status].toLocaleString('en-US')}</span>
            </AriaButton>
          </li>
        ))}
      </ul>
      <ErrorLine error={error} place="inline" />
      <p className="t-body t-num pt-2">{tallyLine(counts)}</p>
      {counts.archived > 0 && (
        <p className="t-secondary text-ink-2 pt-1">{archivedLine(counts.archived)}</p>
      )}
    </PageSection>
  )
}
