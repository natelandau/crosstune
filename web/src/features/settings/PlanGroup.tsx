import { ChevronRight } from 'lucide-react'
import { useId } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import type { Plan } from '../../billing/plan'
import { usePlan } from '../../billing/usePlan'
import { Group } from '../../ui/form/Group'
import { FIELD_ROW_PRESSABLE } from '../../ui/form/FieldRow'
import { useNow } from '../../ui/useNow'
import { membership } from '../plan/membership'
import {
  FREE_HELP,
  FREE_STORAGE_HELP,
  PLAN_FREE,
  PLAN_GROUP,
  PLAN_PREMIUM,
  PLAN_TRIAL,
  SEE_PLAN,
  trialLeft,
} from '../plan/planCopy'
import { usePremiumSheet } from '../plan/PremiumSheetProvider'
import { StorageSummary } from '../recordings/StorageSummary'

/** The plan's name and its end, as the Plan row shows them. */
function planLine(plan: Plan, now: Date): { name: string; detail?: string } {
  if (plan.kind !== 'premium') return { name: PLAN_FREE }
  if (plan.source === 'trial') {
    const end = plan.trialEndsAt ?? plan.premiumEndsAt
    return { name: PLAN_TRIAL, detail: end ? trialLeft(end, now) : undefined }
  }
  const member = membership(plan)
  return {
    name: PLAN_PREMIUM,
    detail: member?.value ? `${member.label} ${member.value}` : undefined,
  }
}

/**
 * The account's plan, as a row that opens the Plan sheet, and how much of its storage is spent.
 * Buying and managing happen in the sheet. Nothing shows until a plan is known.
 */
export function PlanGroup() {
  const plan = usePlan()
  const now = useNow()
  const premium = usePremiumSheet()
  const hintId = useId()
  if (plan.kind === 'unknown') return null
  const { name, detail } = planLine(plan, new Date(now))
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
        <AriaButton
          aria-describedby={hintId}
          onPress={() => premium.open('plan', 'plan_group')}
          className={`${FIELD_ROW_PRESSABLE} py-2`}
        >
          <span className="min-w-0 flex-1">
            <span className="block">{name}</span>
            {detail && <span className="t-secondary text-ink-2 block">{detail}</span>}
          </span>
          <ChevronRight className="text-ink-2 size-4 shrink-0" aria-hidden />
          <span id={hintId} hidden>
            {SEE_PLAN}
          </span>
        </AriaButton>
      </Group>
      <StorageSummary />
    </>
  )
}
