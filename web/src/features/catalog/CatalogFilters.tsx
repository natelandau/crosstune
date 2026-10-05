import { X } from 'lucide-react'
import { Capsule, PressTarget } from '../../ui/Capsule'
import { removeFilterLabel } from '../../ui/filterCopy'
import { KeyPill } from '../../ui/KeyPill'
import { Rail } from '../../ui/Rail'
import { tuningKeyInstrument, withInstrumentLabel } from '../settings/instruments'
import { UNKNOWN_KEY } from '../tune/KeyChooser'
import { StatusChooser } from '../tune/StatusChooser'
import { MISSING_LABEL, UNHEARD_PILL } from './filterLabels'
import {
  FACET_LABELS,
  facetChoices,
  MISSING_LABELS,
  NO_KEY,
  sheetFacets,
  type CatalogFilters as Filters,
  type Facet,
  type FacetValues,
} from './filters'

export const ALL_KEYS_LABEL = 'All keys'
export const ALL_TYPES_LABEL = 'All types'

// A tuning pill names its instrument, since two instruments can share a tuning's name, and a
// composer or learned from pill names its field, since one person can be both.
function pillLabel(facet: Facet, value: string): string {
  const instrument = tuningKeyInstrument(facet)
  if (instrument) return withInstrumentLabel(instrument, value)
  if (facet === 'composer' || facet === 'learned_from') return `${FACET_LABELS[facet]}: ${value}`
  return value
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
  if (filters.unheard)
    pills.push({ key: 'unheard', label: UNHEARD_PILL, patch: { unheard: false } })
  if (filters.missing !== 'all')
    pills.push({
      key: 'missing',
      label: `${MISSING_LABEL} ${MISSING_LABELS[filters.missing]}`,
      patch: { missing: 'all' },
    })

  const keys = facetChoices(facets.key, filters.key)
  const types = facetChoices(facets.tune_type, filters.tune_type)

  return (
    <div className="space-y-2 pt-1 pb-2">
      <StatusChooser
        value={filters.status}
        includeAll
        onChange={(status) => onChange({ status })}
      />

      {visible.includes('key') ? (
        <Rail label="Key">
          <Capsule pressed={keys.selected === 'all'} onPress={() => onChange({ key: 'all' })}>
            {ALL_KEYS_LABEL}
          </Capsule>
          {keys.choices.map((key) =>
            key === NO_KEY ? (
              // The same question mark the key chooser sets, named in words since it reads as
              // nothing aloud.
              <Capsule
                key={key}
                pressed={keys.selected === key}
                label={UNKNOWN_KEY}
                onPress={() => onChange({ key: keys.selected === key ? 'all' : key })}
              >
                ?
              </Capsule>
            ) : (
              <PressTarget
                key={key}
                pressed={keys.selected === key}
                onPress={() => onChange({ key: keys.selected === key ? 'all' : key })}
              >
                <KeyPill value={key} chosen={keys.selected === key} />
              </PressTarget>
            ),
          )}
        </Rail>
      ) : null}

      {visible.includes('tune_type') ? (
        <Rail label={FACET_LABELS.tune_type}>
          <Capsule
            pressed={types.selected === 'all'}
            onPress={() => onChange({ tune_type: 'all' })}
          >
            {ALL_TYPES_LABEL}
          </Capsule>
          {types.choices.map((type) => (
            <Capsule
              key={type}
              pressed={types.selected === type}
              onPress={() => onChange({ tune_type: types.selected === type ? 'all' : type })}
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
              label={removeFilterLabel(pill.label)}
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
