import { X } from 'lucide-react'
import { Capsule, PressTarget } from '../../ui/Capsule'
import { KeyPill } from '../../ui/KeyPill'
import { Rail } from '../../ui/Rail'
import { StatusChooser } from '../tune/StatusChooser'
import {
  sheetFacets,
  type CatalogFilters as Filters,
  type Facet,
  type FacetValues,
} from './filters'

export const ALL_KEYS_LABEL = 'All keys'

export function CatalogFilters({
  filters,
  facets,
  visible,
  onChange,
}: {
  filters: Filters
  facets: FacetValues
  visible: readonly Facet[]
  onChange: (patch: Partial<Filters>) => void
}) {
  const pills: { key: string; label: string; patch: Partial<Filters> }[] = sheetFacets(visible)
    .filter((facet) => filters[facet] !== 'all')
    .map((facet) => ({ key: facet, label: filters[facet], patch: { [facet]: 'all' } }))
  if (filters.archived)
    pills.push({ key: 'archived', label: 'Archived shown', patch: { archived: false } })

  return (
    <div className="space-y-2 pt-1 pb-2">
      <StatusChooser
        value={filters.status}
        includeAll
        onChange={(status) => onChange({ status })}
      />

      {visible.includes('key') ? (
        <Rail label="Key">
          <Capsule pressed={filters.key === 'all'} onPress={() => onChange({ key: 'all' })}>
            {ALL_KEYS_LABEL}
          </Capsule>
          {facets.key.map((key) => (
            <PressTarget
              key={key}
              pressed={filters.key === key}
              onPress={() => onChange({ key: filters.key === key ? 'all' : key })}
            >
              <KeyPill value={key} chosen={filters.key === key} />
            </PressTarget>
          ))}
        </Rail>
      ) : null}

      {pills.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-(--form-gutter)">
          {pills.map((pill) => (
            <Capsule
              key={pill.key}
              filled
              label={`Remove filter ${pill.label}`}
              onPress={() => onChange(pill.patch)}
            >
              {pill.label}
              <X aria-hidden="true" className="size-3.5" />
            </Capsule>
          ))}
        </div>
      ) : null}
    </div>
  )
}
