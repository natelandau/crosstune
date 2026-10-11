import type * as Sdk from '@revenuecat/purchases-js'
import type { Package, Purchases } from '@revenuecat/purchases-js'
import type { PurchaseOutcome, PurchasePeriod, Store, StoreOffer } from './store'

const PACKAGE_IDS: Record<PurchasePeriod, string> = {
  annual: '$rc_annual',
  monthly: '$rc_monthly',
}
const PERIODS: PurchasePeriod[] = ['annual', 'monthly']

/** RevenueCat's web store. The SDK loads on first use, so it stays out of the main bundle. */
export function revenueCatStore(apiKey: string, appUserId: string): Store {
  let session: Promise<{ sdk: typeof Sdk; purchases: Purchases }> | undefined

  function load() {
    const loaded = (session ??= (async () => {
      const sdk = await import('@revenuecat/purchases-js')
      const purchases = sdk.Purchases.isConfigured()
        ? sdk.Purchases.getSharedInstance()
        : sdk.Purchases.configure({ apiKey, appUserId })
      return { sdk, purchases }
    })())
    // A failed load must not stick, or a retry could never recover.
    loaded.catch(() => {
      if (session === loaded) session = undefined
    })
    return loaded
  }

  async function open() {
    const opened = await load()
    // The SDK is a page-wide singleton, so another store may have switched its user since.
    if (opened.purchases.getAppUserId() !== appUserId) {
      await opened.purchases.changeUser(appUserId)
    }
    return opened
  }

  async function packages() {
    const opened = await open()
    const offerings = await opened.purchases.getOfferings()
    const available = offerings.current?.availablePackages ?? []
    const found = new Map<PurchasePeriod, Package>()
    for (const period of PERIODS) {
      const match = available.find((item) => item.identifier === PACKAGE_IDS[period])
      if (match) found.set(period, match)
    }
    return { ...opened, found }
  }

  return {
    async offers(): Promise<StoreOffer[]> {
      const { found } = await packages()
      return PERIODS.flatMap((period) => {
        const item = found.get(period)
        return item ? [{ period, price: item.webBillingProduct.price.formattedPrice }] : []
      })
    },

    async purchase(period: PurchasePeriod): Promise<PurchaseOutcome> {
      const { sdk, purchases, found } = await packages()
      const item = found.get(period)
      if (!item) throw new Error(`No ${period} package in the current offering`)
      try {
        await purchases.purchase({ rcPackage: item })
        return 'completed'
      } catch (error) {
        if (
          error instanceof sdk.PurchasesError &&
          error.errorCode === sdk.ErrorCode.UserCancelledError
        ) {
          return 'cancelled'
        }
        throw error
      }
    },
  }
}
