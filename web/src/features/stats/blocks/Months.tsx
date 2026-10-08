import { useId, useState } from 'react'
import {
  ALL_TIME,
  MONTHS_HEADER,
  monthBarLabel,
  monthLabel,
  RECORDINGS_LABEL,
  TUNES_ADDED_LABEL,
} from '../copy'
import type { Month, Months as MonthsData } from '../types'
import { PageSection } from '../../tune/PageSection'
import { Capsule } from '../../../ui/Capsule'

/**
 * Tunes added and recordings made per month, as two strips of slate bars over the same months.
 * A month with nothing keeps its empty slot, so the spacing reads as time.
 */
export function Months({ months }: { months: MonthsData }) {
  const [allTime, setAllTime] = useState(false)
  const shown = allTime && months.has_all_time ? months.all_time : months.last12
  return (
    <PageSection
      title={MONTHS_HEADER}
      add={
        months.has_all_time ? (
          <Capsule
            label={ALL_TIME}
            set={allTime}
            aria-pressed={allTime}
            onPress={() => setAllTime(!allTime)}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <Strip label={TUNES_ADDED_LABEL} months={shown} count={(month) => month.tunes_added} />
        <Strip label={RECORDINGS_LABEL} months={shown} count={(month) => month.recordings} />
        <div aria-hidden className="t-caption t-num text-ink-2 flex justify-between">
          <span>{monthLabel(shown[0]!.month)}</span>
          <span>{monthLabel(shown[shown.length - 1]!.month)}</span>
        </div>
      </div>
    </PageSection>
  )
}

function Strip({
  label,
  months,
  count,
}: {
  label: string
  months: readonly Month[]
  count: (month: Month) => number
}) {
  const max = Math.max(1, ...months.map(count))
  const labelId = useId()
  return (
    <div>
      <p id={labelId} className="t-secondary text-ink-2 pb-1">
        {label}
      </p>
      <ol aria-labelledby={labelId} className="border-hairline flex h-16 items-end gap-px border-b">
        {months.map((month) => (
          <li key={month.month} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <span className="sr-only">{monthBarLabel(month.month, count(month))}</span>
            <span
              aria-hidden
              className="bg-slate block rounded-t-sm"
              style={{ height: `${(count(month) / max) * 100}%` }}
            />
          </li>
        ))}
      </ol>
    </div>
  )
}
