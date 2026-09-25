import { X } from 'lucide-react'
import { Capsule, PressTarget } from '../../ui/Capsule'
import { KeyPill } from '../../ui/KeyPill'
import { Rail } from '../../ui/Rail'
import { tuningKeyInstrument, withInstrumentLabel } from '../settings/instruments'
import { StatusChooser } from '../tune/StatusChooser'
import {
  FACET_LABELS,
  sheetFacets,
  type CatalogFilters as Filters,
  type Facet,
  type FacetValues,
} from './filters'

export const ALL_KEYS_LABEL = 'All keys'
export const ALL_TYPES_LABEL = 'All types'

// A tuning pill names its instrument, since two instruments can share a tuning's name.
function pillLabel(facet: Facet, value: string): string {
  const instrument = tuningKeyInstrument(facet)
  return instrument ? withInstrumentLabel(instrument, value) : value
}

// A set value the catalog no longer holds keeps its chip, so the rail never reads as All.
function railChoices(values: readonly string[], set: string): readonly string[] {
  return set !== 'all' && !values.includes(set) ? [...values, set] : values
}

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
    .map((facet) => ({
      key: facet,
      label: pillLabel(facet, filters[facet]),
      patch: { [facet]: 'all' },
    }))
  if (filters.archived)
    pills.push({ key: 'archived', label: 'Archived shown', patch: { archived: false } })

  const keyChoices = railChoices(facets.key, filters.key)
  const typeChoices = railChoices(facets.tune_type, filters.tune_type)

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
          {keyChoices.map((key) => (
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

      {visible.includes('tune_type') ? (
        <Rail label={FACET_LABELS.tune_type}>
          <Capsule
            pressed={filters.tune_type === 'all'}
            onPress={() => onChange({ tune_type: 'all' })}
          >
            {ALL_TYPES_LABEL}
          </Capsule>
          {typeChoices.map((type) => (
            <Capsule
              key={type}
              pressed={filters.tune_type === type}
              onPress={() => onChange({ tune_type: filters.tune_type === type ? 'all' : type })}
            >
              {type}
            </Capsule>
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
