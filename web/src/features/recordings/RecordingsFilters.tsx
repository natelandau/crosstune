import { X } from 'lucide-react'
import { Capsule } from '../../ui/Capsule'
import { removeFilterLabel } from '../../ui/filterCopy'
import { originLabel } from './recordingRow'
import { MY_RECORDINGS } from './RecordingsFilterSheet'
import type { OriginChoice } from './useRecordingsOrigin'

/** The set filter as a removable capsule; nothing while the source is All. */
export function RecordingsFilters({
  choice,
  onChange,
}: {
  choice: OriginChoice
  onChange: (next: OriginChoice) => void
}) {
  if (choice === 'all') return null
  const label = originLabel(choice) ?? MY_RECORDINGS
  return (
    <div className="flex flex-wrap gap-1 px-(--form-gutter) pt-1 pb-2">
      <Capsule filled label={removeFilterLabel(label)} onPress={() => onChange('all')}>
        {label}
        <X aria-hidden="true" className="size-3.5" />
      </Capsule>
    </div>
  )
}
