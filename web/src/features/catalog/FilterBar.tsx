import { STATUSES } from '../../db/types'
import { STATUS_LABELS } from './StatusDot'
import { FACET_LABELS, type CatalogFilters, type Facet, type FacetValues } from './filters'

interface Props {
  filters: CatalogFilters
  facets: FacetValues
  visible: readonly Facet[]
  onChange: (patch: Partial<CatalogFilters>) => void
}

function FacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <select
      className="select min-h-11"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="all">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

export function FilterBar({ filters, facets, visible, onChange }: Props) {
  return (
    <div className="space-y-2">
      <div className="join w-full" role="group" aria-label="Status">
        <button
          type="button"
          className={`btn join-item min-h-11 flex-1 ${filters.status === 'all' ? 'btn-active' : ''}`}
          aria-pressed={filters.status === 'all'}
          onClick={() => onChange({ status: 'all' })}
        >
          All
        </button>
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={`btn join-item min-h-11 flex-1 ${filters.status === status ? 'btn-active' : ''}`}
            aria-pressed={filters.status === status}
            onClick={() => onChange({ status })}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {visible.map((facet) => (
          <FacetSelect
            key={facet}
            label={FACET_LABELS[facet]}
            value={filters[facet]}
            options={facets[facet]}
            onChange={(value) => {
              const patch: Partial<CatalogFilters> = {}
              patch[facet] = value
              onChange(patch)
            }}
          />
        ))}
        <label className="label cursor-pointer gap-2 text-sm">
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={filters.archived}
            onChange={(e) => onChange({ archived: e.target.checked })}
          />
          Show archived
        </label>
      </div>
    </div>
  )
}
