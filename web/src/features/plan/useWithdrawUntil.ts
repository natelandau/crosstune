import { useEffect, useState } from 'react'
import { useEntitlement, usePlanOrUnknown } from '../../billing/usePlan'
import { useFixedNow, useNow } from '../../ui/useNow'

// setTimeout fires at once for a delay past a signed 32-bit integer.
const MAX_TIMER_MS = 2_147_483_647

/**
 * The instant the account's withdrawal window closes, or null when it cannot withdraw: no window,
 * one that has closed, or a plan with no web subscription behind it. It turns null at the
 * instant itself, not at the next minute's tick, since the server refuses from then on.
 */
export function useWithdrawUntil(): Date | null {
  const now = useNow()
  const fixed = useFixedNow()
  const row = useEntitlement()
  const plan = usePlanOrUnknown()
  // The window end that has passed on the real clock, so a stale `now` cannot show it again.
  const [passed, setPassed] = useState<number | null>(null)
  const end = row?.withdraw_until ? Date.parse(row.withdraw_until) : null
  const live = end !== null && end > now && end !== passed && plan.paidSources.includes('stripe')
  useEffect(() => {
    if (!live || fixed) return
    const timer = setTimeout(() => setPassed(end), Math.min(end - Date.now(), MAX_TIMER_MS))
    return () => clearTimeout(timer)
  }, [live, fixed, end])
  return live ? new Date(end) : null
}
