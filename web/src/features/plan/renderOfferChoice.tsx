import type { ReactNode } from 'react'
import { PeriodTiles } from './PeriodTiles'
import type { PlanOffer } from './usePlanOffer'

/**
 * What sits above Subscribe: the periods to choose between, or `line`, which says why there is
 * nothing to buy. Undefined when neither shows, so a sheet leaves the slot out.
 */
export function renderOfferChoice(offer: PlanOffer, line: string | null = offer.line): ReactNode {
  const { options, chosen } = offer
  if (options.kind === 'choice' && chosen)
    return <PeriodTiles offers={options.offers} period={chosen} onChange={offer.setPeriod} />
  if (!line) return undefined
  return (
    <p className={`t-secondary ${options.kind === 'offline' ? 'text-secondary' : ''}`}>{line}</p>
  )
}
