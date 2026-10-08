import { ChevronRight } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { FACET_LABELS, type CatalogFilters } from '../../catalog/filters'
import { breakdownGroups, valueFilter } from '../breakdowns'
import { showAllLabel, valueLabel } from '../copy'
import type { Breakdowns as BreakdownsData, Value } from '../types'
import { PageSection } from '../../tune/PageSection'
import { ErrorLine } from '../../../ui/ErrorLine'
import { KeyGrid } from './KeyGrid'
import { PRESS } from './press'

/** How many values a breakdown shows before Show all. */
const VISIBLE = 8

type OnFilter = (patch: Partial<CatalogFilters>, header: string) => void

/**
 * One group per attribute the catalog uses, in a fixed order. A value that is a catalog filter
 * opens the catalog with only that filter; time signature only counts. A filter that could not
 * be saved reports under the group it was tapped in.
 */
export function Breakdowns({
  breakdowns,
  onFilter,
  filterError,
}: {
  breakdowns: BreakdownsData
  onFilter: OnFilter
  filterError: (header: string) => string | null
}) {
  return (
    <>
      {breakdowns.key.length > 0 && (
        <KeyGrid
          rows={breakdowns.key}
          onFilter={(patch) => onFilter(patch, FACET_LABELS.key)}
          error={filterError(FACET_LABELS.key)}
        />
      )}
      {breakdownGroups(breakdowns).map(({ header, values, facet }) => (
        <Breakdown
          key={header}
          title={header}
          values={values}
          onOpen={(value) => {
            const patch = valueFilter(facet, value)
            return patch ? () => onFilter(patch, header) : undefined
          }}
          error={filterError(header)}
        />
      ))}
    </>
  )
}

/**
 * A breakdown's values, each over a thin slate bar as wide as its share of the largest. A value
 * `onOpen` gives an action to is a control; any other only reads. Past 8 values the rest wait
 * behind a Show all row, which expands the list in place.
 */
export function Breakdown({
  title,
  values,
  onOpen = () => undefined,
  error = null,
}: {
  title: string
  values: readonly Value[]
  onOpen?: (value: string) => (() => void) | undefined
  error?: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const list = useRef<HTMLUListElement>(null)
  const revealed = useRef(false)

  // The Show all row goes away as it expands, so focus moves on to the first value it revealed.
  useLayoutEffect(() => {
    if (!expanded || !revealed.current) return
    revealed.current = false
    const row = list.current?.children[VISIBLE] as HTMLElement | undefined
    const target = row?.querySelector<HTMLElement>('button') ?? row
    if (!target) return
    if (target === row) target.tabIndex = -1
    target.focus()
  }, [expanded])

  if (values.length === 0) return null
  const hidden = !expanded && values.length > VISIBLE
  const shown = hidden ? values.slice(0, VISIBLE) : values
  const peak = Math.max(...values.map((value) => value.count))
  return (
    <PageSection title={title}>
      <ul ref={list} className="flex flex-col">
        {shown.map(({ value, count }) => (
          <li key={value} className="outline-none">
            <ShareRow value={value} count={count} peak={peak} onOpen={onOpen(value)} />
          </li>
        ))}
      </ul>
      {hidden && (
        <AriaButton
          onPress={() => {
            revealed.current = true
            setExpanded(true)
          }}
          className={`t-body text-slate flex min-h-(--target) items-center ${PRESS}`}
        >
          {showAllLabel(values.length)}
        </AriaButton>
      )}
      <ErrorLine error={error} place="inline" />
    </PageSection>
  )
}

const SHARE_ROW = 'relative flex min-h-(--target) w-full items-center gap-2 pt-1 pb-3 text-start'

function ShareRow({
  value,
  count,
  peak,
  onOpen,
}: {
  value: string
  count: number
  peak: number
  onOpen: (() => void) | undefined
}) {
  const face = (
    <>
      <span className="t-body min-w-0 flex-1 truncate">{value}</span>
      <span className="t-body t-num text-ink-2">{count.toLocaleString('en-US')}</span>
      {onOpen && <ChevronRight className="text-ink-2 size-4 shrink-0" aria-hidden />}
      <span aria-hidden className="absolute inset-x-0 bottom-1 h-1">
        <span
          className="bg-slate/55 block h-full rounded-full"
          style={{ width: `${peak > 0 ? (count / peak) * 100 : 0}%` }}
        />
      </span>
    </>
  )
  if (onOpen)
    return (
      <AriaButton
        aria-label={valueLabel(value, count)}
        onPress={onOpen}
        className={`${SHARE_ROW} ${PRESS}`}
      >
        {face}
      </AriaButton>
    )
  return (
    <div className={SHARE_ROW}>
      <span className="sr-only">{valueLabel(value, count)}</span>
      <span aria-hidden className="contents">
        {face}
      </span>
    </div>
  )
}
