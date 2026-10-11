import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { PremiumEntry, PremiumReason, PurchasePeriod } from '../../usage/events'
import { useLatest } from '../../ui/useLatest'
import { settingsPagePath } from '../settings/settingsPaths'
import { PremiumSheet } from './PremiumSheet'
import { usePurchase } from './usePurchase'

export type { PremiumEntry, PremiumReason }

export interface PremiumSheetLauncher {
  /** Shows the Premium sheet for what a free account tapped, or for the plan itself, and from where. */
  open: (reason: PremiumReason, from: PremiumEntry) => void
}

interface Checkout {
  period: PurchasePeriod
  from: PremiumEntry
}

const NOTHING: PremiumSheetLauncher = { open: () => {} }

const PremiumSheetContext = createContext<PremiumSheetLauncher>(NOTHING)

/** Holds the one Premium sheet, so any gated control can answer a tap with it. */
export function PremiumSheetProvider({
  navigate,
  children,
}: {
  navigate: (to: string) => void
  children: ReactNode
}) {
  const analytics = useAnalytics()
  const purchase = usePurchase()
  const [shown, setShown] = useState<{
    reason: PremiumReason | null
    from: PremiumEntry | null
    open: boolean
  }>({ reason: null, from: null, open: false })
  const chosen = useRef<Checkout | null>(null)
  // Set once the sheet has left, so RevenueCat's checkout never opens under its inert backdrop.
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const purchaseRef = useLatest(purchase)
  useEffect(() => {
    if (checkout) purchaseRef.current.start(checkout.period, checkout.from)
  }, [checkout, purchaseRef])
  const close = () => setShown((current) => ({ ...current, open: false }))
  const launcher = useMemo<PremiumSheetLauncher>(
    () => ({
      open: (next, from) => {
        chosen.current = null
        setShown({ reason: next, from, open: true })
        analytics.send('premium_sheet_shown', { reason: next, from })
      },
    }),
    [analytics],
  )
  return (
    <PremiumSheetContext value={launcher}>
      {children}
      <PremiumSheet
        open={shown.open}
        reason={shown.reason}
        onClose={close}
        // A sheet asked for again while it was leaving keeps its reason.
        onClosed={() => {
          setShown((current) => (current.open ? current : { ...current, reason: null }))
          if (chosen.current) setCheckout(chosen.current)
          chosen.current = null
        }}
        onSeePlan={() => {
          close()
          navigate(settingsPagePath('account'))
        }}
        onSubscribe={(period) => {
          if (shown.from) chosen.current = { period, from: shown.from }
          close()
        }}
      />
    </PremiumSheetContext>
  )
}

/** The Premium sheet's launcher, which does nothing in a tree with no provider. */
// A context module pairs its provider component with the hook that reads it.
// eslint-disable-next-line react-refresh/only-export-components
export function usePremiumSheet(): PremiumSheetLauncher {
  return useContext(PremiumSheetContext)
}
