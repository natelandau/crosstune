import { SlidersHorizontal, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ChoiceChips } from '../../components/ChoiceChips'
import { STATUSES } from '../../db/types'
import { FilterSheet } from './FilterSheet'
import { STATUS_LABELS } from './StatusDot'
import {
  FACET_LABELS,
  sheetFacets,
  sheetFilterCount,
  songCountLabel,
  type CatalogCounts,
  type CatalogFilters,
  type Facet,
  type FacetValues,
} from './filters'

interface Props {
  /** The search form, rendered beside the filter button. */
  search: ReactNode
  filters: CatalogFilters
  facets: FacetValues
  visible: readonly Facet[]
  counts: CatalogCounts
  onChange: (patch: Partial<CatalogFilters>) => void
  /** Placed at the right of the count row. */
  trailing?: ReactNode
}

function Pill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-primary btn-sm min-h-11 rounded-full pr-2 pl-3 font-medium"
      aria-label={`Remove filter ${label}`}
      onClick={onRemove}
    >
      {label}
      <X aria-hidden="true" className="size-3.5" />
    </button>
  )
}

export function FilterBar({ search, filters, facets, visible, counts, onChange, trailing }: Props) {
  const [open, setOpen] = useState(false)
  const setCount = sheetFilterCount(filters, visible)
  const pills: { key: Facet | 'archived'; label: string; patch: Partial<CatalogFilters> }[] =
    sheetFacets(visible)
      .filter((facet) => filters[facet] !== 'all')
      .map((facet) => ({ key: facet, label: filters[facet], patch: { [facet]: 'all' } }))
  if (filters.archived)
    pills.push({ key: 'archived', label: 'Archived shown', patch: { archived: false } })

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">{search}</div>
        <button
          type="button"
          className={`btn btn-square relative min-h-11 ${setCount > 0 ? 'btn-primary' : ''}`}
          aria-label={setCount > 0 ? `Filters, ${setCount} set` : 'Filters'}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <SlidersHorizontal aria-hidden="true" className="size-5" />
          {setCount > 0 ? (
            <span
              aria-hidden="true"
              className="badge badge-sm bg-base-100 text-base-content absolute -top-1.5 -right-1.5 tabular-nums"
            >
              {setCount}
            </span>
          ) : null}
        </button>
      </div>
      <div className="join w-full" role="group" aria-label="Status">
        <button
          type="button"
          className={`btn join-item h-auto min-h-11 flex-1 py-1 ${filters.status === 'all' ? 'btn-primary' : ''}`}
          aria-pressed={filters.status === 'all'}
          onClick={() => onChange({ status: 'all' })}
        >
          All
        </button>
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={`btn join-item h-auto min-h-11 flex-1 py-1 ${filters.status === status ? 'btn-primary' : ''}`}
            aria-pressed={filters.status === status}
            onClick={() => onChange({ status })}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      {visible.includes('key') ? (
        <ChoiceChips
          label={FACET_LABELS.key}
          rail
          emptyOption="All"
          value={filters.key === 'all' ? '' : filters.key}
          options={facets.key}
          onChange={(value) => onChange({ key: value === '' ? 'all' : value })}
        />
      ) : null}
      {pills.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {pills.map((pill) => (
            <Pill key={pill.key} label={pill.label} onRemove={() => onChange(pill.patch)} />
          ))}
        </div>
      ) : null}
      {counts.all > 0 ? (
        <div className="flex min-h-9 items-center justify-between gap-2">
          <p className="text-meta tabular-nums opacity-70" aria-live="polite">
            {songCountLabel(counts.visible, counts.total)}
          </p>
          {trailing}
        </div>
      ) : null}
      <FilterSheet
        open={open}
        filters={filters}
        facets={facets}
        visible={visible}
        counts={counts}
        onChange={onChange}
        onClose={() => setOpen(false)}
      />
    </div>
  )
}
