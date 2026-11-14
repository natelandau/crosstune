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
import { useOnline } from '../../sync/SyncProvider'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { PremiumEntry, PremiumReason, PurchasePeriod } from '../../usage/events'
import { useLatest } from '../../ui/useLatest'
import { useResetOnChange } from '../../ui/useResetOnChange'
import { exportReadiness } from '../recordings/export/readiness'
import type { ExportItem } from '../recordings/export/runRecordingExport'
import { RecordingExportSheet } from '../recordings/export/RecordingExportSheet'
import { useRecordingExportSheet } from '../recordings/export/useRecordingExportSheet'
import type { RecordingView } from '../recordings/useRecordings'
import { ExportSheet } from '../settings/pages/ExportSheet'
import type { PremiumSubject } from './planCopy'
import { PlanSheet } from './PlanSheet'
import { usePlanContext } from './usePlanContext'
import { usePurchase } from './usePurchase'

export type { PremiumEntry, PremiumReason, PremiumSubject }

export interface PremiumSheetLauncher {
  /**
   * Shows the Plan sheet for what a free account tapped, or for the plan itself, and from where.
   * `subject` is the one recording it opened from, which its export action then offers.
   */
  open: (reason: PremiumReason, from: PremiumEntry, subject?: PremiumSubject) => void
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

/** What the sheet's choice asked for, run once the sheet has left. */
type AfterClose =
  | { kind: 'checkout'; checkout: Checkout }
  | { kind: 'recording'; view: RecordingView }
  | { kind: 'all' }

const NOTHING: PremiumSheetLauncher = { open: () => {}, checkout: async () => {} }

const PremiumSheetContext = createContext<PremiumSheetLauncher>(NOTHING)

// Apart from the launcher, so the launcher keeps its identity while a checkout comes and goes.
const CheckoutOpenContext = createContext(false)
const SettledContext = createContext(false)

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
    subject: PremiumSubject | null
    open: boolean
  }>({ reason: null, from: null, subject: null, open: false })
  const afterClose = useRef<AfterClose | null>(null)
  const recordingExport = useRecordingExportSheet()
  const online = useOnline()
  // The subject's export running with no sheet, so a failure can open the sheet on it.
  const subjectItems = useRef<readonly ExportItem[] | null>(null)
  const { state: exportState, reveal } = recordingExport
  useEffect(() => {
    if (exportState.kind !== 'failed' && exportState.kind !== 'done') return
    if (exportState.kind === 'failed' && subjectItems.current) reveal(subjectItems.current)
    subjectItems.current = null
  }, [exportState.kind, reveal])
  const [exportingAll, setExportingAll] = useState(false)
  const { context, subjectView } = usePlanContext(shown.reason, shown.subject)
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
      open: (next, from, subject) => {
        afterClose.current = null
        setShown({ reason: next, from, subject: subject ?? null, open: true })
        analytics.send('premium_sheet_shown', { reason: next, from, presentation: 'sheet' })
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
      <CheckoutOpenContext value={inFlight > 0}>
        <SettledContext value={settled}>{children}</SettledContext>
      </CheckoutOpenContext>
      <PlanSheet
        open={shown.open}
        context={context}
        settled={settled}
        onClose={close}
        // A sheet asked for again while it was leaving keeps its reason.
        onClosed={() => {
          setShown((current) =>
            current.open ? current : { ...current, reason: null, subject: null },
          )
          const next = afterClose.current
          afterClose.current = null
          switch (next?.kind) {
            case 'checkout':
              setInFlight((count) => count + 1)
              setCheckout(next.checkout)
              break
            case 'recording':
              // A file held here downloads with no sheet; the sheet opens on a failure, since
              // nothing else here can show it.
              {
                const items = [{ view: next.view, readiness: exportReadiness(next.view, online) }]
                if (items[0]?.readiness.kind === 'local') {
                  // An export still running would refuse this one and later answer for it.
                  recordingExport.cancel()
                  subjectItems.current = items
                  recordingExport.exportItems(items, 'download')
                } else recordingExport.download(items)
              }
              break
            case 'all':
              setExportingAll(true)
              break
          }
        }}
        onSubscribe={(period) => {
          if (shown.from)
            afterClose.current = { kind: 'checkout', checkout: { period, from: shown.from } }
          close()
        }}
        onAction={(action) => {
          if (action === 'export_all') afterClose.current = { kind: 'all' }
          // Until the recording reads there is nothing to export, so the sheet stays.
          else if (subjectView) afterClose.current = { kind: 'recording', view: subjectView }
          else return
          close()
        }}
      />
      <RecordingExportSheet {...recordingExport.sheet} />
      {exportingAll && <ExportSheet open onClosed={() => setExportingAll(false)} />}
    </PremiumSheetContext>
  )
}

/** Whether a checkout is open, or asked for and about to open, from the Plan sheet or a notice. */
// eslint-disable-next-line react-refresh/only-export-components
export function useCheckoutOpen(): boolean {
  return useContext(CheckoutOpenContext)
}

/**
 * Whether a purchase went through this session and the synced plan has not followed yet, so
 * nothing that sells the plan sells it again.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePurchaseSettled(): boolean {
  return useContext(SettledContext)
}

/** The Plan sheet's launcher, which does nothing in a tree with no provider. */
// A context module pairs its provider component with the hook that reads it.
// eslint-disable-next-line react-refresh/only-export-components
export function usePremiumSheet(): PremiumSheetLauncher {
  return useContext(PremiumSheetContext)
}
