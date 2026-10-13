import { ArrowUpRight } from 'lucide-react'
import { FIELD_ROW_PRESSABLE } from '../../ui/form/FieldRow'
import type { Manage, Membership } from './membership'
import { APP_STORE_SUBSCRIPTIONS_URL, MANAGE_APP_STORE, MANAGE_SUBSCRIPTION } from './planCopy'

const MANAGE_ROW = `${FIELD_ROW_PRESSABLE} border-hairline text-action not-first:border-t`

/**
 * A member's plan: when it renews or ends, or that Crosstune granted it, and where to manage it.
 * No price or period, since the synced entitlement carries neither.
 */
export function MembershipCard({
  membership,
  manage,
}: {
  membership: Membership | null
  manage: Manage[]
}) {
  if (!membership && manage.length === 0) return null
  return (
    <div className="bg-fill flex flex-col rounded-(--radius-surface) *:first:rounded-t-(--radius-surface) *:last:rounded-b-(--radius-surface)">
      {membership && (
        <p className="t-body flex min-h-(--target) items-center gap-3 px-4">
          <span className="shrink-0">{membership.label}</span>
          {membership.value && (
            <span className="text-ink-2 min-w-0 flex-1 text-end">{membership.value}</span>
          )}
        </p>
      )}
      {manage.map((place) => (
        <a
          key={place.kind}
          className={MANAGE_ROW}
          href={place.kind === 'portal' ? place.url : APP_STORE_SUBSCRIPTIONS_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="flex-1">
            {place.kind === 'portal' ? MANAGE_SUBSCRIPTION : MANAGE_APP_STORE}
          </span>
          <ArrowUpRight className="size-4 shrink-0" aria-hidden />
        </a>
      ))}
    </div>
  )
}
