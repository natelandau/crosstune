import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { planMode } from '../../billing/plan'
import { usePlanOrUnknown } from '../../billing/usePlan'
import { useDb } from '../../db/DbProvider'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { PremiumEntry, PremiumReason, PurchasePeriod } from '../../usage/events'
import { useLatest } from '../../ui/useLatest'
import { useResetOnChange } from '../../ui/useResetOnChange'
import { PlanSheet } from './PlanSheet'
import { usePurchase } from './usePurchase'

export type { PremiumEntry, PremiumReason }

export interface PremiumSheetLauncher {
  /** Shows the Plan sheet for what a free account tapped, or for the plan itself, and from where. */
  open: (reason: PremiumReason, from: PremiumEntry) => void
  /**
   * Opens the store's checkout at once, for a caller whose own sheet has already left. A purchase
   * that goes through settles the Plan sheet, as one bought from it does.
   */
  checkout: (period: PurchasePeriod, from: PremiumEntry) => Promise<void>
}

interface Checkout {
  period: PurchasePeriod
  from: PremiumEntry
}

const NOTHING: PremiumSheetLauncher = { open: () => {}, checkout: async () => {} }

const PremiumSheetContext = createContext<PremiumSheetLauncher>(NOTHING)

// Apart from the launcher, so the launcher keeps its identity while a checkout comes and goes.
const CheckoutOpenContext = createContext(false)

/** Holds the one Plan sheet, so any gated control can answer a tap with it. */
export function PremiumSheetProvider({ children }: { children: ReactNode }) {
  const analytics = useAnalytics()
  const purchase = usePurchase()
  const mode = planMode(usePlanOrUnknown())
  // The database is per account, so it names whose purchase went through.
  const db = useDb()
  const dbRef = useLatest(db)
  // A purchase that went through, held until the synced plan changes, so the sheet never sells
  // again to an account that just bought. Another account never inherits it.
  const [settled, setSettled] = useState(false)
  useResetOnChange(mode, () => setSettled(false))
  useResetOnChange(db, () => setSettled(false))
  const [shown, setShown] = useState<{
    reason: PremiumReason | null
    from: PremiumEntry | null
    open: boolean
  }>({ reason: null, from: null, open: false })
  const chosen = useRef<Checkout | null>(null)
  // Set once the sheet has left, so RevenueCat's checkout never opens under its inert backdrop.
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  // Checkouts asked for and not yet answered, counted from the moment one is asked for, so
  // nothing opens over the store's window in the commit before it appears.
  const [inFlight, setInFlight] = useState(0)
  const settle = useCallback(() => setInFlight((count) => count - 1), [])
  const purchaseRef = useLatest(purchase)
  const buy = useCallback(
    async ({ period, from }: Checkout) => {
      const buyer = dbRef.current
      const completed = await purchaseRef.current.start(period, from)
      if (completed && dbRef.current === buyer) setSettled(true)
    },
    [purchaseRef, dbRef],
  )
  useEffect(() => {
    if (checkout) void buy(checkout).finally(settle)
  }, [checkout, buy, settle])
  const close = () => setShown((current) => ({ ...current, open: false }))
  const launcher = useMemo<PremiumSheetLauncher>(
    () => ({
      open: (next, from) => {
        chosen.current = null
        setShown({ reason: next, from, open: true })
        analytics.send('premium_sheet_shown', { reason: next, from })
      },
      checkout: (period, from) => {
        setInFlight((count) => count + 1)
        return buy({ period, from }).finally(settle)
      },
    }),
    [analytics, buy, settle],
  )
  return (
    <PremiumSheetContext value={launcher}>
      <CheckoutOpenContext value={inFlight > 0}>{children}</CheckoutOpenContext>
      <PlanSheet
        open={shown.open}
        reason={shown.reason}
        settled={settled}
        onClose={close}
        // A sheet asked for again while it was leaving keeps its reason.
        onClosed={() => {
          setShown((current) => (current.open ? current : { ...current, reason: null }))
          if (chosen.current) {
            setInFlight((count) => count + 1)
            setCheckout(chosen.current)
          }
          chosen.current = null
        }}
        onSubscribe={(period) => {
          if (shown.from) chosen.current = { period, from: shown.from }
          close()
        }}
      />
    </PremiumSheetContext>
  )
}

/** Whether a checkout is open, or asked for and about to open, from the Plan sheet or a notice. */
// eslint-disable-next-line react-refresh/only-export-components
export function useCheckoutOpen(): boolean {
  return useContext(CheckoutOpenContext)
}

/** The Plan sheet's launcher, which does nothing in a tree with no provider. */
// A context module pairs its provider component with the hook that reads it.
// eslint-disable-next-line react-refresh/only-export-components
export function usePremiumSheet(): PremiumSheetLauncher {
  return useContext(PremiumSheetContext)
}
