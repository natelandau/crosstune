import { useEffect, useState } from 'react'
import type { Store, StoreOffer } from '../../billing/store'
import { useResetOnChange } from '../../ui/useResetOnChange'

export type Offers =
  { kind: 'pending' } | { kind: 'failed' } | { kind: 'ready'; offers: StoreOffer[] }

/** What the store sells, asked once each time `open` turns true. A null store asks nothing. */
export function useOffers(store: Store | null, open: boolean): Offers {
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
