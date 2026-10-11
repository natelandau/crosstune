import { Check } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useState } from 'react'
import { Radio, RadioGroup } from 'react-aria-components'
import { canSubscribe } from '../../billing/plan'
import type { Store, StoreOffer } from '../../billing/store'
import { useStore } from '../../billing/StoreProvider'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { useDb } from '../../db/DbProvider'
import { readScanTune } from '../../db/scans'
import { useOnline } from '../../sync/SyncProvider'
import type { PremiumReason, PurchasePeriod } from '../../usage/events'
import { Button } from '../../ui/Button'
import { FIELD_LABEL, FIELD_ROW_PRESSABLE, FIELD_VALUE } from '../../ui/form/FieldRow'
import { Sheet } from '../../ui/Sheet'
import { useResetOnChange } from '../../ui/useResetOnChange'
import {
  annualPrice,
  BILLING_PERIOD,
  BILLING_STARTS_TODAY,
  monthlyPrice,
  PERIOD_ANNUAL,
  PERIOD_MONTHLY,
  PREMIUM_PLAN_BODY,
  PREMIUM_PLAN_TITLE,
  PREMIUM_RECORDINGS_BODY,
  PREMIUM_RECORDINGS_TITLE,
  PREMIUM_SCANS_TITLE,
  premiumScansBody,
  RENEWS_UNTIL_CANCELLED,
  SEE_PLAN,
  SUBSCRIBE,
  SUBSCRIBE_OFFLINE,
} from './planCopy'

const TITLES: Record<PremiumReason, string> = {
  recordings: PREMIUM_RECORDINGS_TITLE,
  scans: PREMIUM_SCANS_TITLE,
  plan: PREMIUM_PLAN_TITLE,
}

const PERIODS: Record<PurchasePeriod, { label: string; price: (price: string) => string }> = {
  annual: { label: PERIOD_ANNUAL, price: annualPrice },
  monthly: { label: PERIOD_MONTHLY, price: monthlyPrice },
}

/**
 * The title of the one tune a free account's scans open on, read only while asked for:
 * undefined until read, and the title null when there is no scan tune.
 */
function useScanTuneTitle(asked: boolean): { title: string | null } | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    if (!asked) return undefined
    const tuneId = await readScanTune(db)
    return { title: tuneId === null ? null : ((await db.tunes.get(tuneId))?.title ?? null) }
  }, [db, asked])
}

type Offers = { kind: 'pending' } | { kind: 'failed' } | { kind: 'ready'; offers: StoreOffer[] }

/** What the store sells, asked once each time the sheet opens. */
function useOffers(store: Store | null, open: boolean): Offers {
  const [offers, setOffers] = useState<Offers>({ kind: 'pending' })
  useResetOnChange(open, () => {
    if (open) setOffers({ kind: 'pending' })
  })
  useEffect(() => {
    if (!open || !store) return
    let current = true
    store.offers().then(
      (found) => {
        if (current) setOffers({ kind: 'ready', offers: found })
      },
      () => {
        if (current) setOffers({ kind: 'failed' })
      },
    )
    return () => {
      current = false
    }
  }, [store, open])
  return offers
}

/**
 * Answers a tap on something a free account cannot use with what Premium holds, headed by what
 * was tapped. Where the store can sell, it offers Annual or Monthly and Subscribe, and otherwise
 * the way to the Plan group.
 */
export function PremiumSheet({
  open,
  reason,
  onClose,
  onClosed,
  onSeePlan,
  onSubscribe,
}: {
  open: boolean
  /** Kept until the sheet has left, so it does not change as it closes; null once it has. */
  reason: PremiumReason | null
  onClose: () => void
  onClosed: () => void
  onSeePlan: () => void
  onSubscribe: (period: PurchasePeriod) => void
}) {
  const bodyId = useId()
  const store = useStore()
  const plan = usePlanOrUnknown()
  const online = useOnline()
  const buyer = store !== null && canSubscribe(plan)
  const offers = useOffers(buyer ? store : null, open)
  const [period, setPeriod] = useState<PurchasePeriod>('annual')
  useResetOnChange(open, () => {
    if (open) setPeriod('annual')
  })
  const scan = useScanTuneTitle(reason === 'scans')
  const body =
    reason === 'recordings'
      ? PREMIUM_RECORDINGS_BODY
      : reason === 'plan'
        ? PREMIUM_PLAN_BODY
        : reason === 'scans' && scan?.title
          ? premiumScansBody(scan.title)
          : null
  // The scans sheet waits for its tune's title, so it opens with its body already in place.
  const ready =
    reason === 'recordings' || reason === 'plan' || (reason === 'scans' && scan !== undefined)
  const choice =
    buyer && online && offers.kind === 'ready' && offers.offers.length > 0 ? offers.offers : null
  // Annual by default, or the one period the store sells when it sells only one.
  const chosen = choice?.some((offer) => offer.period === period) ? period : choice?.[0]?.period
  const offline = buyer && !choice && (!online || offers.kind === 'failed')
  const trial = plan.kind === 'premium' && plan.source === 'trial'
  return (
    <Sheet
      isOpen={open && ready}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={reason ? TITLES[reason] : ''}
      height="part"
      describedBy={body ? bodyId : undefined}
      primary={
        choice
          ? { label: SUBSCRIBE, onPress: () => onSubscribe(chosen ?? period) }
          : { label: SEE_PLAN, onPress: onSeePlan }
      }
      onClosed={onClosed}
    >
      {body && (
        <p id={bodyId} className="t-body pt-2">
          {body}
        </p>
      )}
      {choice ? (
        <>
          <div className="-ms-4 pt-1">
            <Button label={SEE_PLAN} onPress={onSeePlan} />
          </div>
          <PeriodChoice offers={choice} period={chosen ?? period} onChange={setPeriod} />
          <p className="t-secondary text-ink-2 px-4 pt-2">{RENEWS_UNTIL_CANCELLED}</p>
          {trial && <p className="t-secondary text-ink-2 px-4 pt-1">{BILLING_STARTS_TODAY}</p>}
        </>
      ) : (
        offline && <p className="t-secondary text-ink-2 pt-2">{SUBSCRIBE_OFFLINE}</p>
      )}
    </Sheet>
  )
}

/** Annual or Monthly as rows in one inset card, each with its price. */
function PeriodChoice({
  offers,
  period,
  onChange,
}: {
  offers: StoreOffer[]
  period: PurchasePeriod
  onChange: (period: PurchasePeriod) => void
}) {
  const id = useId()
  return (
    <RadioGroup
      aria-label={BILLING_PERIOD}
      value={period}
      onChange={(next) => onChange(next as PurchasePeriod)}
      className="bg-fill mt-4 flex flex-col rounded-(--radius-surface) *:first:rounded-t-(--radius-surface) *:last:rounded-b-(--radius-surface)"
    >
      {offers.map((offer) => {
        const { label, price } = PERIODS[offer.period]
        const priceId = `${id}-${offer.period}`
        return (
          <Radio
            key={offer.period}
            value={offer.period}
            aria-label={label}
            aria-describedby={priceId}
            className={`radio-row ${FIELD_ROW_PRESSABLE}`}
          >
            {({ isSelected }) => (
              <>
                <span className={FIELD_LABEL}>{label}</span>
                <span id={priceId} className={FIELD_VALUE}>
                  {price(offer.price)}
                </span>
                <Check
                  className={`text-action size-5 shrink-0 ${isSelected ? '' : 'invisible'}`}
                  aria-hidden
                />
              </>
            )}
          </Radio>
        )
      })}
    </RadioGroup>
  )
}
