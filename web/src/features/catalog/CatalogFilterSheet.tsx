import { IonButton, IonItem, IonSelect, IonSelectOption, IonToggle } from '@ionic/react'
import { usePointer } from '../../platform/pointer'
import { FieldRow } from '../../ui/FieldRow'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import {
  FACET_LABELS,
  sheetFacets,
  sheetFilterCount,
  sheetResets,
  tuneCountLabel,
  type CatalogCounts,
  type CatalogFilters,
  type Facet,
  type FacetValues,
} from './filters'

export const SHOW_ARCHIVED = 'Show archived'

export function CatalogFilterSheet({
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
  const pointer = usePointer()
  const setCount = sheetFilterCount(filters, visible)
  return (
    <Sheet
      open={open}
      title="Filters"
      onClose={onClose}
      start={
        <IonButton disabled={setCount === 0} onClick={() => onChange(sheetResets(visible))}>
          Reset
        </IonButton>
      }
      end={
        <IonButton strong onClick={onClose}>
          Done
        </IonButton>
      }
    >
      <p className="type-footnote px-(--form-inset) pt-5 tabular-nums" aria-live="polite">
        {tuneCountLabel(counts.visible, counts.total)}
      </p>
      <Group>
        {sheetFacets(visible).map((facet) => {
          // A value the current catalog no longer has (an archived tune's genre, say) still
          // needs its own option, or the select would show it as if it were Any.
          const stale = filters[facet] !== 'all' && !facets[facet].includes(filters[facet])
          const choices = stale ? [...facets[facet], filters[facet]] : facets[facet]
          return (
            <FieldRow key={facet} label={FACET_LABELS[facet]}>
              <IonSelect
                aria-label={FACET_LABELS[facet]}
                interface={pointer === 'mouse' ? 'popover' : 'action-sheet'}
                value={filters[facet]}
                onIonChange={(event) => onChange({ [facet]: String(event.detail.value) })}
              >
                <IonSelectOption value="all">Any</IonSelectOption>
                {choices.map((value) => (
                  <IonSelectOption key={value} value={value}>
                    {value}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </FieldRow>
          )
        })}
      </Group>
      <Group
        footer={
          <>
            <span className="tabular-nums">{counts.archived}</span> archived{' '}
            {counts.archived === 1 ? 'tune' : 'tunes'}
          </>
        }
      >
        <IonItem>
          <IonToggle
            checked={filters.archived}
            onIonChange={(event) => onChange({ archived: event.detail.checked })}
          >
            {SHOW_ARCHIVED}
          </IonToggle>
        </IonItem>
      </Group>
    </Sheet>
  )
}
