import { STATUSES, type TuneStatus } from '../../api/vocabulary'
import { STATUS_LABELS } from '../../constants'
import { countTunes } from '../../text/format'
import { DONE } from '../../ui/confirmCopy'
import { ANY, FILTERS, RESET } from '../../ui/filterCopy'
import { Group } from '../../ui/form/Group'
import { Picker } from '../../ui/form/Picker'
import { asOptions } from '../../ui/form/pickerOptions'
import { Switch } from '../../ui/form/Switch'
import { KEY } from '../../ui/keyName'
import { KeyGrid } from '../../ui/KeyGrid'
import { Sheet } from '../../ui/Sheet'
import { SHOW_ARCHIVED } from './catalogCopy'
import { archivedCountLabel, MISSING_LABEL, SHOW_UNHEARD, type SheetFilters } from './filterLabels'
import {
  FACET_LABELS,
  facetChoices,
  MISSING_LABELS,
  missingFilterChoices,
  NO_KEY,
  ROW_FACETS,
  tuneCountLabel,
  type CatalogCounts,
  type CatalogFilters,
  type FacetValues,
  type MissingAttribute,
} from './filters'
import { STATUS_SCOPE } from './scope'
import type { LiveTuneCounts } from './useStatusCounts'

/**
 * Every catalog filter: Status, Key, the other facets, the unheard and missing filters, and
 * Show archived. Every choice applies at once; Reset clears them all.
 */
export function CatalogFilterSheet({
  isOpen,
  onOpenChange,
  onClosed,
  filters,
  facets,
  sheet,
  missing,
  counts,
  statusCounts,
  onChange,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** Runs once the closed sheet has left the page. */
  onClosed?: () => void
  filters: CatalogFilters
  facets: FacetValues
  sheet: SheetFilters
  /** The attributes worth asking about, so Missing offers no empty answer. */
  missing: readonly MissingAttribute[]
  counts: CatalogCounts
  /** Each status's absolute count, for the Status choice. */
  statusCounts: LiveTuneCounts | undefined
  onChange: (patch: Partial<CatalogFilters>) => void
}) {
  const described = (count: number | undefined) => (count ? countTunes(count) : undefined)
  const keyFacet = sheet.facets.includes('key')
  const keys = facetChoices(facets.key, filters.key)
  const pickers = sheet.facets.filter((facet) => !ROW_FACETS.includes(facet))
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onClosed={onClosed}
      title={FILTERS}
      cancel={null}
      tertiary={{
        label: RESET,
        onPress: () => onChange(sheet.reset),
        isDisabled: sheet.count === 0,
      }}
      primary={{ label: DONE, onPress: () => onOpenChange(false) }}
    >
      <p className="t-secondary text-ink-2 t-num px-4 pt-2" aria-live="polite">
        {tuneCountLabel(counts.visible, counts.total)}
      </p>
      <Group>
        <Picker
          label={STATUS_SCOPE}
          value={filters.status === 'all' ? null : filters.status}
          options={STATUSES.map((value) => ({
            id: value,
            label: STATUS_LABELS[value],
            description: described(statusCounts?.byStatus[value]),
          }))}
          emptyLabel={ANY}
          onChange={(value) => onChange({ status: (value ?? 'all') as TuneStatus | 'all' })}
        />
      </Group>
      {keyFacet && (
        <Group header={KEY} plain>
          <KeyGrid
            value={keys.selected === 'all' ? null : keys.selected}
            keys={keys.choices}
            noKey={NO_KEY}
            anyLabel={ANY}
            onChange={(key) => onChange({ key: key ?? 'all' })}
          />
        </Group>
      )}
      {pickers.length > 0 && (
        <Group>
          {pickers.map((facet) => {
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
