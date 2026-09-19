import { IonLabel, IonSegment, IonSegmentButton } from '@ionic/react'
import { X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { STATUSES } from '../../db/types'
import { Capsule } from '../../ui/Capsule'
import {
  sheetFacets,
  type CatalogFilters as Filters,
  type Facet,
  type FacetValues,
} from './filters'
import { STATUS_LABELS } from './status'

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

  const railRef = useRef<HTMLDivElement>(null)
  const [keyRailFade, setKeyRailFade] = useState(false)

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const updateFade = () => {
      const overflow = rail.scrollWidth - rail.clientWidth > 1
      // In RTL, scrollLeft runs zero at the start to negative at the end, mirroring LTR's
      // zero-to-positive, so its absolute value measures distance from the start either way.
      const atEnd = Math.abs(rail.scrollLeft) >= rail.scrollWidth - rail.clientWidth - 1
      setKeyRailFade(overflow && !atEnd)
    }
    updateFade()
    rail.addEventListener('scroll', updateFade, { passive: true })
    window.addEventListener('resize', updateFade)
    return () => {
      rail.removeEventListener('scroll', updateFade)
      window.removeEventListener('resize', updateFade)
    }
  }, [facets.key, visible])

  return (
    <div className="space-y-2 px-4 pt-1 pb-2">
      <IonSegment
        aria-label="Status"
        value={filters.status}
        onIonChange={(event) => onChange({ status: event.detail.value as Filters['status'] })}
      >
        <IonSegmentButton value="all">
          <IonLabel>All</IonLabel>
        </IonSegmentButton>
        {STATUSES.map((status) => (
          <IonSegmentButton key={status} value={status}>
            <IonLabel>{STATUS_LABELS[status]}</IonLabel>
          </IonSegmentButton>
        ))}
      </IonSegment>

      {visible.includes('key') ? (
        <div
          ref={railRef}
          role="group"
          aria-label="Key"
          data-fade={keyRailFade || undefined}
          className="key-rail -mx-4 flex [scrollbar-width:none] gap-1 overflow-x-auto px-4"
        >
          <Capsule pressed={filters.key === 'all'} onPress={() => onChange({ key: 'all' })}>
            All
          </Capsule>
          {facets.key.map((key) => (
            <Capsule
              key={key}
              pressed={filters.key === key}
              onPress={() => onChange({ key: filters.key === key ? 'all' : key })}
            >
              {key}
            </Capsule>
          ))}
        </div>
      ) : null}

      {pills.length > 0 ? (
        <div className="flex flex-wrap gap-1">
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
