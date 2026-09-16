import { ChipsField, ChoiceChips } from '../../components/ChoiceChips'
import { SwitchRow } from '../../components/DetailRow'
import { HelpText } from '../../components/Page'
import { Sheet } from '../../components/Sheet'
import {
  FACET_LABELS,
  sheetFacets,
  sheetFilterCount,
  sheetResets,
  songCountLabel,
  type CatalogCounts,
  type CatalogFilters,
  type Facet,
  type FacetValues,
} from './filters'

export function FilterSheet({
  open,
  filters,
  facets,
  visible,
  counts,
  onChange,
  onClose,
}: {
  open: boolean
  filters: CatalogFilters
  facets: FacetValues
  visible: readonly Facet[]
  counts: CatalogCounts
  onChange: (patch: Partial<CatalogFilters>) => void
  onClose: () => void
}) {
  const setCount = sheetFilterCount(filters, visible)
  return (
    <Sheet
      open={open}
      title="Filters"
      onClose={onClose}
      action={
        <button
          type="button"
          className="btn btn-ghost btn-sm min-h-11"
          disabled={setCount === 0}
          onClick={() => onChange(sheetResets(visible))}
        >
          Reset
        </button>
      }
    >
      <HelpText>{songCountLabel(counts.visible, counts.total)}</HelpText>
      <div className="mt-3 space-y-4">
        {sheetFacets(visible).map((facet) => (
          <ChipsField key={facet} label={FACET_LABELS[facet]}>
            <ChoiceChips
              label={FACET_LABELS[facet]}
              value={filters[facet] === 'all' ? '' : filters[facet]}
              options={facets[facet]}
              emptyOption="Any"
              onChange={(value) => {
                const patch: Partial<CatalogFilters> = {}
                patch[facet] = value === '' ? 'all' : value
                onChange(patch)
              }}
            />
          </ChipsField>
        ))}
        <SwitchRow
          label="Show archived"
          checked={filters.archived}
          help={`${counts.archived} archived ${counts.archived === 1 ? 'song' : 'songs'}`}
          onChange={(archived) => onChange({ archived })}
        />
      </div>
      <button type="button" className="btn btn-primary mt-4 min-h-11 w-full" onClick={onClose}>
        Done
      </button>
    </Sheet>
  )
}
