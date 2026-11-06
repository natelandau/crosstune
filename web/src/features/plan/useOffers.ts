import { useEffect, useState } from 'react'
import type { Store, StoreOffer } from '../../billing/store'
import { useOnline } from '../../sync/SyncProvider'
import { useResetOnChange } from '../../ui/useResetOnChange'

export type Offers =
  { kind: 'pending' } | { kind: 'failed' } | { kind: 'ready'; offers: StoreOffer[] }

/**
 * What the store sells, asked once each time `open` turns true, and again when the browser
 * reconnects after a failed answer. A null store asks nothing.
 */
export function useOffers(store: Store | null, open: boolean): Offers {
  const online = useOnline()
  const [offers, setOffers] = useState<Offers>({ kind: 'pending' })
  const [reconnects, setReconnects] = useState(0)
  useResetOnChange(open, () => {
    if (open) setOffers({ kind: 'pending' })
  })
  // An answer that failed while offline would otherwise read as the store being unavailable.
  useResetOnChange(online, () => {
    if (online && offers.kind === 'failed') {
      setOffers({ kind: 'pending' })
      setReconnects((count) => count + 1)
    }
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
  }, [store, open, reconnects])
  return offers
}
