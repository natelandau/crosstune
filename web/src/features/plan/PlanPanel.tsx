import { usePlanOrUnknown } from '../../billing/usePlan'
import { Button } from '../../ui/Button'
import { useSubheadingLevel } from '../../ui/headingLevel'
import { Mark } from '../../ui/Mark'
import {
  EXPORT_EVERYTHING,
  EXPORT_THIS_RECORDING,
  type PlanAction,
  type PlanContext,
} from './planCopy'
import { PlanComparison } from './PlanComparison'
import { TrialCard } from './TrialCard'

const ACTION_LABEL: Record<PlanAction, string> = {
  export_recording: EXPORT_THIS_RECORDING,
  export_all: EXPORT_EVERYTHING,
}

/**
 * What a free or trial account reads before it buys: the mark, why the plan shows, a trial's
 * card, and how Free and Premium compare. The caller places it and supplies the purchase
 * controls, with `PlanExport` beneath Subscribe.
 */
export function PlanPanel({
  context,
  headlineId,
  bodyId,
}: {
  /** Null while nothing asks for the plan, such as a sheet that has closed. */
  context: PlanContext | null
  headlineId: string
  bodyId: string
}) {
  const plan = usePlanOrUnknown()
  const Headline = `h${useSubheadingLevel()}` as const
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex flex-col items-center gap-1 text-center">
        <Mark className="mb-3 h-10" />
        <Headline id={headlineId} className="t-screen-title break-words">
          {context?.title ?? ''}
        </Headline>
        {context?.body && (
          <p id={bodyId} className="t-body text-secondary">
            {context.body}
          </p>
        )}
      </div>
      {plan.kind === 'premium' && plan.source === 'trial' && (
        <TrialCard startsAt={plan.trialStartsAt} endsAt={plan.trialEndsAt ?? plan.premiumEndsAt} />
      )}
      <PlanComparison />
    </div>
  )
}

/** The export the context offers, as a text button beneath Subscribe. */
export function PlanExport({
  context,
  onAction,
}: {
  context: PlanContext | null
  onAction: (action: PlanAction) => void
}) {
  const action = context?.action ?? null
  if (!action) return null
  return (
    <div className="flex justify-center">
      <Button label={ACTION_LABEL[action]} onPress={() => onAction(action)} />
    </div>
  )
}
