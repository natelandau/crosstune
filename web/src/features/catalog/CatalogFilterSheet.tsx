import { SHOW_ARCHIVED } from './catalogCopy'
import { archivedCountLabel, MISSING_LABEL, SHOW_UNHEARD, type SheetFilters } from './filterLabels'
import {
  FACET_LABELS,
  facetChoices,
  MISSING_LABELS,
  missingFilterChoices,
  tuneCountLabel,
  type CatalogCounts,
  type CatalogFilters,
  type FacetValues,
  type MissingAttribute,
} from './filters'
import { DONE } from '../../ui/confirmCopy'
import { ANY, FILTERS, RESET } from '../../ui/filterCopy'
import { Group } from '../../ui/form/Group'
import { Picker } from '../../ui/form/Picker'
import { Switch } from '../../ui/form/Switch'
import { Sheet } from '../../ui/Sheet'

const asOptions = (values: readonly string[]) =>
  values.map((value) => ({ id: value, label: value }))

/**
 * Type and the other facets the filter row has no room for, the unheard and missing filters,
 * and Show archived. Every choice applies at once; Reset clears only this sheet's filters.
 */
export function CatalogFilterSheet({
  isOpen,
  onOpenChange,
  filters,
  facets,
  sheet,
  missing,
  counts,
  onChange,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  filters: CatalogFilters
  facets: FacetValues
  sheet: SheetFilters
  /** The attributes worth asking about, so Missing offers no empty answer. */
  missing: readonly MissingAttribute[]
  counts: CatalogCounts
  onChange: (patch: Partial<CatalogFilters>) => void
}) {
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={FILTERS}
      leading={{
        label: RESET,
        onPress: () => onChange(sheet.reset),
        isDisabled: sheet.count === 0,
      }}
      primary={{ label: DONE, onPress: () => onOpenChange(false) }}
    >
      <p className="t-secondary text-ink-2 t-num px-4 pt-2" aria-live="polite">
        {tuneCountLabel(counts.visible, counts.total)}
      </p>
      {sheet.facets.length > 0 && (
        <Group>
          {sheet.facets.map((facet) => {
            const { choices, selected } = facetChoices(facets[facet], filters[facet])
            return (
              <Picker
                key={facet}
                label={FACET_LABELS[facet]}
                value={selected === 'all' ? null : selected}
                options={asOptions(choices)}
                emptyLabel={ANY}
                onChange={(value) => onChange({ [facet]: value ?? 'all' })}
              />
            )
          })}
        </Group>
      )}
      <Group>
        <Switch
          label={SHOW_UNHEARD}
          isSelected={filters.unheard}
          onChange={(unheard) => onChange({ unheard })}
        />
        <Picker
          label={MISSING_LABEL}
          value={filters.missing === 'all' ? null : filters.missing}
          options={missingFilterChoices(missing, filters.missing).map((attribute) => ({
            id: attribute,
            label: MISSING_LABELS[attribute],
          }))}
          emptyLabel={ANY}
          onChange={(value) => onChange({ missing: (value ?? 'all') as CatalogFilters['missing'] })}
        />
      </Group>
      <Group footer={archivedCountLabel(counts.archived)}>
        <Switch
          label={SHOW_ARCHIVED}
          isSelected={filters.archived}
          onChange={(archived) => onChange({ archived })}
        />
      </Group>
    </Sheet>
  )
}
