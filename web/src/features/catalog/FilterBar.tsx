import { STATUSES } from '../../db/types'
import { STATUS_LABELS } from './StatusBadge'
import type { CatalogFilters } from './filters'

interface Props {
  filters: CatalogFilters
  facets: { keys: string[]; modes: string[]; tunings: string[]; genres: string[] }
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

export function FilterBar({ filters, facets, onChange }: Props) {
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
        <FacetSelect
          label="Key"
          value={filters.key}
          options={facets.keys}
          onChange={(key) => onChange({ key })}
        />
        <FacetSelect
          label="Mode"
          value={filters.mode}
          options={facets.modes}
          onChange={(mode) => onChange({ mode })}
        />
        <FacetSelect
          label="Tuning"
          value={filters.tuning}
          options={facets.tunings}
          onChange={(tuning) => onChange({ tuning })}
        />
        <FacetSelect
          label="Genre"
          value={filters.genre}
          options={facets.genres}
          onChange={(genre) => onChange({ genre })}
        />
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
