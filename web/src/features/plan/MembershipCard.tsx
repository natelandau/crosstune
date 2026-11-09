import { PressableRow } from '../../ui/PressableRow'
import type { Manage, Membership } from './membership'
import { WithdrawRow } from './WithdrawRow'
import { APP_STORE_SUBSCRIPTIONS_URL, MANAGE_APP_STORE, MANAGE_SUBSCRIPTION } from './planCopy'
import { GROUP_CARD } from '../../ui/form/Group'

/**
 * A member's plan: when it renews or ends, or that Crosstune granted it, and where to manage it.
 * No price or period, since the synced entitlement carries neither.
 */
export function MembershipCard({
  membership,
  manage,
  withdrawUntil,
}: {
  membership: Membership | null
  manage: Manage[]
  /** The last day the account can withdraw for a refund, or null when it cannot. */
  withdrawUntil: Date | null
}) {
  if (!membership && manage.length === 0 && !withdrawUntil) return null
  return (
    // A group's card without a group's section, since the plan sheet spaces its own parts.
    <div className={GROUP_CARD}>
      {membership && (
        <p className="t-body flex min-h-(--size-row) items-center gap-3 px-4">
          <span className="shrink-0">{membership.label}</span>
          {membership.value && (
            <span className="text-secondary min-w-0 flex-1 text-end">{membership.value}</span>
          )}
        </p>
      )}
      {manage.map((place) => (
        <PressableRow
          key={place.kind}
          href={place.kind === 'portal' ? place.url : APP_STORE_SUBSCRIPTIONS_URL}
          className="text-primary"
        >
          <span className="flex-1">
            {place.kind === 'portal' ? MANAGE_SUBSCRIPTION : MANAGE_APP_STORE}
          </span>
        </PressableRow>
      ))}
      {withdrawUntil && <WithdrawRow until={withdrawUntil} />}
    </div>
  )
}
