import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { TuneStatus } from '../../api/vocabulary'
import { facetControlLabel, type SheetFilters } from './filterLabels'
import {
  facetChoices,
  NO_KEY,
  type CatalogCounts,
  type CatalogFilters,
  type Facet,
  type FacetValues,
  type MissingAttribute,
} from './filters'
import type { LiveTuneCounts } from './useStatusCounts'
import { ANY, FILTERS, filtersLabel, removeFilterLabel } from '../../ui/filterCopy'
import { KEY } from '../../ui/keyName'
import { useStampedDensity } from '../../platform/density'
import { Capsule } from '../../ui/Capsule'
import { FilterRow } from '../../ui/FilterRow'
import { KeyGrid } from '../../ui/KeyGrid'
import { PopoverDialog } from '../../ui/PopoverDialog'
import { Sheet } from '../../ui/Sheet'
import { CatalogFilterSheet } from './CatalogFilterSheet'
import { statusControlLabel } from './scope'
import { StatusScopeMenu } from './StatusScope'

/** The name of the row that holds the catalog's filter controls and set filters. */
export const FILTER_ROW = 'Filter tunes'

function PullDown({ label }: { label: string }) {
  return (
    <>
      {label}
      <ChevronDown className="size-3.5 opacity-60" aria-hidden />
    </>
  )
}

function KeyControl({
  values,
  value,
  onChange,
}: {
  values: readonly string[]
  value: string
  onChange: (key: string) => void
}) {
  const touch = useStampedDensity() === 'touch'
  const [isOpen, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { choices, selected } = facetChoices(values, value)
  const label = facetControlLabel('key', selected)
  const grid = (
    <KeyGrid
      value={selected === 'all' ? null : selected}
      keys={choices}
      noKey={NO_KEY}
      anyLabel={ANY}
      autoFocus
      onChange={(key) => {
        onChange(key ?? 'all')
        setOpen(false)
      }}
    />
  )
  return (
    <>
      <Capsule
        ref={triggerRef}
        label={label}
        set={selected !== 'all'}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onPress={() => setOpen(true)}
      >
        <PullDown label={label} />
      </Capsule>
      {touch ? (
        <Sheet isOpen={isOpen} onOpenChange={setOpen} title={KEY}>
          <div className="pt-2">{grid}</div>
        </Sheet>
      ) : (
        <PopoverDialog
          label={KEY}
          triggerRef={triggerRef}
          isOpen={isOpen}
          onOpenChange={setOpen}
          className="w-72"
        >
          {grid}
        </PopoverDialog>
      )}
    </>
  )
}

function StatusControl({
  status,
  counts,
  onChange,
}: {
  status: TuneStatus | 'all'
  counts: LiveTuneCounts | undefined
  onChange: (status: TuneStatus | 'all') => void
}) {
  const label = statusControlLabel(status)
  return (
    <StatusScopeMenu
      status={status}
      counts={counts}
      onChoose={onChange}
      trigger={
        <Capsule label={label} set={status !== 'all'}>
          <PullDown label={label} />
        </Capsule>
      }
    />
  )
}

/**
 * The catalog's filter row under the search field: Status, Key when the catalog holds keys,
 * Filters with its count, then each set sheet filter as a token that removes it. Filters
 * stays in place, disabled, while the list loads or holds no tunes, when the empty state
 * already says why.
 */
export function CatalogFilterRow({
  ready,
  filters,
  facets,
  visible,
  missing,
  counts,
  sheet,
  statusCounts,
  onChange,
}: {
  ready: boolean
  /** The effective filters, with hidden facets already reset. */
  filters: CatalogFilters
  facets: FacetValues
  visible: readonly Facet[]
  missing: readonly MissingAttribute[]
  counts: CatalogCounts
  sheet: SheetFilters
  /** Each status's absolute count, for the Status choice. */
  statusCounts: LiveTuneCounts | undefined
  onChange: (patch: Partial<CatalogFilters>) => void
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const usable = ready && counts.all > 0
  const tokens = usable ? sheet.tokens : []
  const setCount = sheet.count
  return (
    <>
      {/* Mounted afresh once the filters have read, so the row counts the saved filters as
          already set and does not scroll to the last of them on every launch. */}
      <FilterRow key={usable ? 'ready' : 'loading'} label={FILTER_ROW}>
        {usable && (
          <StatusControl
            status={filters.status}
            counts={statusCounts}
            onChange={(status) => onChange({ status })}
          />
        )}
        {usable && visible.includes('key') && (
          <KeyControl
            values={facets.key}
            value={filters.key}
            onChange={(key) => onChange({ key })}
          />
        )}
        <Capsule
          label={filtersLabel(setCount)}
          set={setCount > 0}
          isDisabled={!usable}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen && usable}
          onPress={() => setSheetOpen(true)}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
          {FILTERS}
          {setCount > 0 && <span className="t-num">{setCount}</span>}
        </Capsule>
        {tokens.map((token) => (
          <Capsule
            key={token.key}
            label={removeFilterLabel(token.label)}
            set
            onPress={() => onChange(token.patch)}
          >
            {token.label}
            <X className="size-3.5" aria-hidden />
          </Capsule>
        ))}
      </FilterRow>
      <CatalogFilterSheet
        isOpen={sheetOpen && usable}
        onOpenChange={setSheetOpen}
        filters={filters}
        facets={facets}
        sheet={sheet}
        missing={missing}
        counts={counts}
        onChange={onChange}
      />
    </>
  )
}
