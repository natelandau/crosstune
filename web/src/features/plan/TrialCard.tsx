import { trialProgress } from '../../billing/plan'
import { useNow } from '../../ui/useNow'
import {
  PLAN_TRIAL,
  TRIAL_KEEPS,
  TRIAL_STORAGE,
  trialDaysLeft,
  trialEndsLine,
  trialLeft,
} from './planCopy'

/**
 * A trial's days left as the card's headline, the day it ends, how much of it has passed, and
 * what it holds and keeps. On its last day the headline says so and the date line drops.
 */
export function TrialCard({ startsAt, endsAt }: { startsAt: Date | null; endsAt: Date | null }) {
  const now = new Date(useNow())
  const percent = endsAt ? Math.round(trialProgress(startsAt, endsAt, now) * 100) : null
  const endsLine = endsAt && trialEndsLine(endsAt, now)
  return (
    <div className="bg-tint flex flex-col gap-1 rounded-(--radius) p-4">
      <p className="t-secondary text-secondary font-semibold">{PLAN_TRIAL}</p>
      {endsAt && percent !== null && (
        <>
          <p className="t-screen-title t-num">{trialDaysLeft(endsAt, now)}</p>
          {endsLine && <p className="t-secondary text-secondary">{endsLine}</p>}
          <div
            role="progressbar"
            aria-label={PLAN_TRIAL}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={trialLeft(endsAt, now)}
            className="bg-tint-strongest my-2 h-1.5 overflow-hidden rounded-full"
          >
            <div
              className="bg-text-secondary h-full rounded-full"
              style={{ width: `${percent}%` }}
            />
          </div>
        </>
      )}
      <p className="t-secondary text-secondary">{TRIAL_STORAGE}</p>
      <p className="t-secondary text-secondary">{TRIAL_KEEPS}</p>
    </div>
  )
}
