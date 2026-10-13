import { useId } from 'react'
import { Radio, RadioGroup } from 'react-aria-components'
import type { StoreOffer } from '../../billing/store'
import type { PurchasePeriod } from '../../usage/events'
import {
  annualPrice,
  BILLING_PERIOD,
  monthlyPrice,
  PERIOD_ANNUAL,
  PERIOD_MONTHLY,
  save,
  saving,
} from './planCopy'

const PERIODS: Record<PurchasePeriod, { label: string; price: (price: string) => string }> = {
  annual: { label: PERIOD_ANNUAL, price: annualPrice },
  monthly: { label: PERIOD_MONTHLY, price: monthlyPrice },
}

const ORDER: readonly PurchasePeriod[] = ['annual', 'monthly']

/** The store's offers, Annual first, one per period. */
function soldPeriods(offers: readonly StoreOffer[]): StoreOffer[] {
  return ORDER.flatMap((period) => offers.find((offer) => offer.period === period) ?? [])
}

/**
 * Annual or Monthly as two cards, each with its price, and Annual with its saving. The saving is
 * worked out from the store's own two amounts, so it shows only when both periods are sold.
 */
export function PeriodTiles({
  offers,
  period,
  onChange,
}: {
  offers: readonly StoreOffer[]
  period: PurchasePeriod
  onChange: (period: PurchasePeriod) => void
}) {
  const id = useId()
  const sold = soldPeriods(offers)
  const annual = sold.find((offer) => offer.period === 'annual')
  const monthly = sold.find((offer) => offer.period === 'monthly')
  const percent = annual && monthly ? saving(annual.amountMicros, monthly.amountMicros) : null
  return (
    <RadioGroup
      aria-label={BILLING_PERIOD}
      orientation="horizontal"
      value={period}
      onChange={(next) => onChange(next as PurchasePeriod)}
      className="flex gap-2"
    >
      {sold.map((offer) => {
        const { label, price } = PERIODS[offer.period]
        const priceId = `${id}-${offer.period}-price`
        const badgeId = `${id}-${offer.period}-badge`
        const badge = offer.period === 'annual' && percent !== null ? save(percent) : null
        return (
          <Radio
            key={offer.period}
            value={offer.period}
            aria-label={label}
            aria-describedby={badge ? `${priceId} ${badgeId}` : priceId}
            className="radio-tile group bg-fill hover:bg-fill-hover border-hairline data-selected:border-slate relative flex min-w-0 flex-1 cursor-default flex-col gap-0.5 rounded-(--radius-surface) border-2 px-3 pt-2.5 pb-2 transition-colors duration-(--dur-short) ease-(--ease)"
          >
            {badge && (
              <span
                id={badgeId}
                className="t-caption bg-coral text-on-coral absolute end-3 -top-2 rounded-(--radius-capsule) px-2 font-semibold"
              >
                {badge}
              </span>
            )}
            <span className="flex items-center gap-2">
              <span
                className="border-ink-2 group-data-selected:border-slate grid size-4 shrink-0 place-items-center rounded-full border-2"
                aria-hidden
              >
                <span className="bg-slate size-2 scale-0 rounded-full transition-transform duration-(--dur-short) group-data-selected:scale-100" />
              </span>
              <span className="t-secondary font-semibold">{label}</span>
            </span>
            <span id={priceId} className="t-heading t-num break-words">
              {price(offer.price)}
            </span>
          </Radio>
        )
      })}
    </RadioGroup>
  )
}
