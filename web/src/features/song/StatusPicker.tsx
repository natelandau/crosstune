import { useId } from 'react'
import { STATUSES, type SongStatus } from '../../db/types'
import { STATUS_LABELS } from '../catalog/StatusBadge'

export function StatusPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (status: SongStatus) => void
}) {
  const groupName = useId()
  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">Status</legend>
      <div className="join w-full">
        {STATUSES.map((status) => (
          <label
            key={status}
            className={`btn join-item min-h-11 flex-1 ${value === status ? 'btn-active' : ''}`}
          >
            <input
              type="radio"
              className="sr-only"
              name={groupName}
              value={status}
              aria-label={STATUS_LABELS[status]}
              checked={value === status}
              onChange={() => onChange(status)}
            />
            {STATUS_LABELS[status]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
