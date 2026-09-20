import { STATUSES, type SongStatus } from '../../db/types'
import { Capsule } from '../../ui/Capsule'
import { isSongStatus, STATUS_LABELS } from '../catalog/status'

/**
 * The dot beside each label. A chosen capsule fills with `primary`, and `success` is that same
 * slate, so the chosen dot takes the contrast color instead of vanishing into the fill it sits
 * on. The label carries the meaning either way: status is never color alone.
 */
const DOT: Record<SongStatus, { rest: string; chosen: string }> = {
  known: {
    rest: 'bg-(--ion-color-success)',
    chosen: 'bg-(--ion-color-primary-contrast)',
  },
  learning: {
    rest: 'bg-(--ion-color-warning)',
    chosen: 'bg-(--ion-color-primary-contrast)',
  },
  want_to_learn: {
    rest: 'border-2 border-(--ion-color-medium)',
    chosen: 'border-2 border-(--ion-color-primary-contrast)',
  },
}

/**
 * A song's status as a row of capsules, the same control the key grid uses directly below it,
 * so the two read as two fields rather than as a control and a toolbar.
 *
 * A song always has a status, so this one never clears: pressing the chosen capsule leaves it
 * chosen, unlike the key grid where pressing the chosen key means "no key".
 */
export function StatusChooser({
  value,
  onChange,
}: {
  /** The stored status, which may be a value this client does not know. */
  value: string
  onChange: (value: SongStatus) => void
}) {
  const current = isSongStatus(value) ? value : 'want_to_learn'
  return (
    <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5 px-(--form-gutter)">
      {STATUSES.map((status) => {
        const chosen = current === status
        return (
          <Capsule
            key={status}
            pressed={chosen}
            label={STATUS_LABELS[status]}
            onPress={() => onChange(status)}
          >
            <span
              data-status-dot
              aria-hidden="true"
              className={`size-2.5 rounded-full ${chosen ? DOT[status].chosen : DOT[status].rest}`}
            />
            {STATUS_LABELS[status]}
          </Capsule>
        )
      })}
    </div>
  )
}
