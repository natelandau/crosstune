import { trialProgress } from '../../billing/plan'
import { useNow } from '../../ui/useNow'
import {
  calendarDaysLeft,
  PLAN_TRIAL,
  TRIAL_KEEPS,
  TRIAL_STORAGE,
  trialDaysLeft,
  trialEnds,
  trialLeft,
} from './planCopy'

/**
 * A trial's days left as the card's headline, the day it ends, how much of it has passed, and
 * what it holds and keeps. On its last day the headline says so and the date line drops.
 */
export function TrialCard({ startsAt, endsAt }: { startsAt: Date | null; endsAt: Date | null }) {
  const now = new Date(useNow())
  const percent = endsAt ? Math.round(trialProgress(startsAt, endsAt, now) * 100) : null
  const lastDay = endsAt !== null && calendarDaysLeft(endsAt, now) <= 0
  return (
    // Secondary ink falls under 4.5:1 on the slate tint, so the card takes the nav's darker one.
    <div className="bg-tint flex flex-col gap-1 rounded-(--radius-surface) p-4 [--ink-2:var(--nav-ink-2)]">
      <p className="t-secondary text-ink-2 font-semibold">{PLAN_TRIAL}</p>
      {endsAt && percent !== null && (
        <>
          <p className="t-screen-title t-num">{trialDaysLeft(endsAt, now)}</p>
          {!lastDay && <p className="t-secondary text-ink-2">{trialEnds(endsAt)}</p>}
          <div
            role="progressbar"
            aria-label={PLAN_TRIAL}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={trialLeft(endsAt, now)}
            className="bg-tint-strong my-2 h-1.5 overflow-hidden rounded-full"
          >
            <div className="bg-slate h-full rounded-full" style={{ width: `${percent}%` }} />
          </div>
        </>
      )}
      <p className="t-secondary text-ink-2">{TRIAL_STORAGE}</p>
      <p className="t-secondary text-ink-2">{TRIAL_KEEPS}</p>
    </div>
  )
}
