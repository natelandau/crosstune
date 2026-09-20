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
type ChooserProps =
  | {
      /** The stored status, which may be a value this client cannot read. */
      value: string
      onChange: (value: SongStatus) => void
      includeAll?: false
    }
  | {
      /** The filter's status, or `all` while it narrows nothing. */
      value: string
      onChange: (value: SongStatus | 'all') => void
      /** Leads the row with All, for the catalog, where this narrows a list rather than
       * setting a song's own status. */
      includeAll: true
    }

export function StatusChooser({ value, onChange, includeAll = false }: ChooserProps) {
  // A status a song holds but this client cannot read still shows as want to learn; a filter
  // set to all matches none of the three and leaves every capsule unpressed but All.
  const current = isSongStatus(value) ? value : includeAll ? null : 'want_to_learn'
  return (
    <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5 px-(--form-gutter)">
      {includeAll ? (
        <Capsule
          pressed={current === null}
          label="All"
          // Only the includeAll arm can be reached here, and only it accepts `all`.
          onPress={() => (onChange as (value: SongStatus | 'all') => void)('all')}
        >
          All
        </Capsule>
      ) : null}
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
