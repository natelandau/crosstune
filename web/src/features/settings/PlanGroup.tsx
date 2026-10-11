import { ArrowUpRight } from 'lucide-react'
import { canSubscribe, type Plan } from '../../billing/plan'
import { storeConfig } from '../../billing/storeConfig'
import { useStore } from '../../billing/StoreProvider'
import { usePlan } from '../../billing/usePlan'
import { Group } from '../../ui/form/Group'
import { StatusRow } from '../../ui/form/StatusRow'
import { useNow } from '../../ui/useNow'
import {
  APP_STORE_SUBSCRIPTIONS_URL,
  FREE_HELP,
  FREE_STORAGE_HELP,
  MANAGE_APP_STORE,
  MANAGE_SUBSCRIPTION,
  PLAN_FREE,
  PLAN_GROUP,
  PLAN_PREMIUM,
  PLAN_TRIAL,
  premiumUntil,
  SUBSCRIBE,
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
  return {
    name: PLAN_PREMIUM,
    detail: plan.premiumEndsAt ? premiumUntil(plan.premiumEndsAt) : undefined,
  }
}

/** Where a paid account manages its subscription, or null when this app has nowhere to send it. */
function manageAction(plan: Plan, portalUrl: string): { label: string; url: string } | null {
  if (plan.source === 'stripe' && portalUrl) return { label: MANAGE_SUBSCRIPTION, url: portalUrl }
  if (plan.source === 'apple') return { label: MANAGE_APP_STORE, url: APP_STORE_SUBSCRIPTIONS_URL }
  return null
}

/** The account's plan and how much of its storage is spent. Nothing shows until a plan is known. */
export function PlanGroup() {
  const plan = usePlan()
  const now = useNow()
  const store = useStore()
  const premium = usePremiumSheet()
  if (plan.kind === 'unknown') return null
  const { name, detail } = planLine(plan, new Date(now))
  const manage = manageAction(plan, storeConfig().portalUrl)
  const open = (url: string) => window.open(url, '_blank', 'noopener')
  const subscribe = store !== null && canSubscribe(plan)
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
        <StatusRow
          title={name}
          detail={detail}
          action={
            subscribe
              ? {
                  label: SUBSCRIBE,
                  prominent: true,
                  onPress: () => premium.open('plan', 'plan_group'),
                }
              : manage
                ? { label: manage.label, icon: ArrowUpRight, onPress: () => open(manage.url) }
                : undefined
          }
        />
      </Group>
      <StorageSummary />
    </>
  )
}
