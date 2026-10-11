import { usePlan } from '../../billing/usePlan'
import { FieldRow } from '../../ui/form/FieldRow'
import { Group } from '../../ui/form/Group'
import { useNow } from '../../ui/useNow'
import {
  FREE_HELP,
  FREE_STORAGE_HELP,
  PLAN_FREE,
  PLAN_GROUP,
  PLAN_PREMIUM,
  PLAN_TRIAL,
  premiumUntil,
  trialLeft,
} from '../plan/planCopy'
import { StorageSummary } from '../recordings/StorageSummary'

/** The account's plan and how much of its storage is spent. Nothing shows until a plan is known. */
export function PlanGroup() {
  const plan = usePlan()
  const now = useNow()
  if (plan.kind === 'unknown') return null
  const trial = plan.kind === 'premium' && plan.source === 'trial'
  const trialEnd = plan.trialEndsAt ?? plan.premiumEndsAt
  let name = PLAN_FREE
  let detail: string | undefined
  if (trial) {
    name = PLAN_TRIAL
    detail = trialEnd ? trialLeft(trialEnd, new Date(now)) : undefined
  } else if (plan.kind === 'premium') {
    name = PLAN_PREMIUM
    detail = plan.premiumEndsAt ? premiumUntil(plan.premiumEndsAt) : undefined
  }
  return (
    <>
      <Group
        header={PLAN_GROUP}
        help={
          plan.kind === 'free' ? (
            <>
              <span className="block">{FREE_HELP}</span>
              {plan.scansOnly && <span className="mt-1 block">{FREE_STORAGE_HELP}</span>}
            </>
          ) : undefined
        }
      >
        <FieldRow label={name} value={detail} />
      </Group>
      <StorageSummary />
    </>
  )
}
