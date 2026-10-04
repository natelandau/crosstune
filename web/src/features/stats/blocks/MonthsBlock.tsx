import { useId, useState } from 'react'
import { Capsule } from '../../../ui/Capsule'
import { Group } from '../../../ui/Group'
import {
  ALL_TIME,
  MONTHS_HEADER,
  monthBarLabel,
  monthLabel,
  RECORDINGS_LABEL,
  TUNES_ADDED_LABEL,
} from '../copy'
import type { Month, Months } from '../types'

/**
 * Tunes added and recordings made per month, as two strips of bars over the same months. A month
 * with nothing keeps its empty slot, so the spacing reads as time.
 */
export function MonthsBlock({ months }: { months: Months }) {
  const [allTime, setAllTime] = useState(false)
  const shown = allTime && months.has_all_time ? months.all_time : months.last12
  return (
    <Group
      header={MONTHS_HEADER}
      plain
      actions={
        months.has_all_time ? (
          <Capsule pressed={allTime} onPress={() => setAllTime(!allTime)}>
            {ALL_TIME}
          </Capsule>
        ) : null
      }
    >
      <div className="flex flex-col gap-3 px-(--form-gutter)">
        <Strip label={TUNES_ADDED_LABEL} months={shown} count={(month) => month.tunes_added} />
        <Strip label={RECORDINGS_LABEL} months={shown} count={(month) => month.recordings} />
        <div aria-hidden="true" className="type-caption flex justify-between tabular-nums">
          <span>{monthLabel(shown[0]!.month)}</span>
          <span>{monthLabel(shown[shown.length - 1]!.month)}</span>
        </div>
      </div>
    </Group>
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
      <p id={labelId} className="type-footnote pb-1">
        {label}
      </p>
      <ol
        aria-labelledby={labelId}
        className="flex h-16 items-end gap-px border-b border-(--fill-tertiary)"
      >
        {months.map((month) => (
          <li key={month.month} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <span className="sr-only">{monthBarLabel(month.month, count(month))}</span>
            <span
              aria-hidden="true"
              className="block rounded-t-sm bg-(--ion-color-primary)"
              style={{ height: `${(count(month) / max) * 100}%` }}
            />
          </li>
        ))}
      </ol>
    </div>
  )
}
