import { useMemo } from 'react'
import type { PurchasePeriod } from '../../billing/store'
import { useStore } from '../../billing/StoreProvider'
import { useSyncEngine } from '../../sync/SyncProvider'
import { useToast } from '../../ui/Toast'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { PremiumEntry } from '../../usage/events'
import { SUBSCRIBE_FAILED, SUBSCRIBED } from './planCopy'

export interface Purchase {
  /** Opens the store's checkout for a period, then brings the new plan to this device. */
  start(period: PurchasePeriod, from: PremiumEntry): void
}

/** Buys Premium through the web store, saying only whether it finished. */
export function usePurchase(): Purchase {
  const store = useStore()
  const engine = useSyncEngine()
  const toast = useToast()
  const analytics = useAnalytics()
  return useMemo<Purchase>(
    () => ({
      start(period, from) {
        if (!store) return
        analytics.send('purchase_started', { period, from })
        void (async () => {
          let outcome
          try {
            outcome = await store.purchase(period)
          } catch {
            analytics.send('purchase_failed', { period, reason: 'error' })
            toast.show(SUBSCRIBE_FAILED)
            return
          }
          if (outcome === 'cancelled') {
            analytics.send('purchase_failed', { period, reason: 'cancelled' })
            return
          }
          analytics.send('purchase_completed', { period })
          try {
            await engine.refreshBilling()
          } catch (caught) {
            // The store's webhook grants the plan too, and a later sync brings it.
            console.warn('billing: could not refresh after a purchase', caught)
          }
          void engine.sync()
          toast.show(SUBSCRIBED)
        })()
      },
    }),
    [store, engine, toast, analytics],
  )
}
