import { useEntitlement } from '../../billing/usePlan'
import type { PurchasePeriod } from '../../usage/events'
import { PRIVACY_POLICY, PRIVACY_URL, renewalTerms, TERMS_OF_USE, TERMS_URL } from './planCopy'

/** The renewal and the legal pages, which every surface that sells shows beside its price. */
export function RenewalTerms({ price, period }: { price: string; period: PurchasePeriod }) {
  const link = 'text-ink underline-offset-2 hover:underline'
  const withdrawable = useEntitlement()?.withdrawal_used !== true
  return (
    <div className="t-caption text-ink-2 flex flex-col items-center gap-1 text-center">
      <p>{renewalTerms(price, period, withdrawable)}</p>
      <p>
        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={link}>
          {TERMS_OF_USE}
        </a>
        <span aria-hidden> · </span>
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={link}>
          {PRIVACY_POLICY}
        </a>
      </p>
    </div>
  )
}
