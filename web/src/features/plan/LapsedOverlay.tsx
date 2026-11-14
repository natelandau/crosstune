import { useEffect, useId, useRef } from 'react'
import { useAnalytics } from '../../usage/AnalyticsProvider'
import type { PremiumEntry } from '../../usage/events'
import { Button } from '../../ui/Button'
import { ErrorLine } from '../../ui/ErrorLine'
import { scrim, SHEET } from '../../ui/sheetGeometry'
import { renderOfferChoice } from './renderOfferChoice'
import type { RecordingView } from '../recordings/useRecordings'
import { PlanExport, PlanPanel } from './PlanPanel'
import { SUBSCRIBE_UNAVAILABLE_TITLE, type PlanAction } from './planCopy'
import { usePremiumSheet, usePurchaseSettled } from './PremiumSheetProvider'
import { RenewalTerms } from './RenewalTerms'
import { usePlanContext } from './usePlanContext'
import { usePlanOffer } from './usePlanOffer'

/**
 * The Plan sheet as a panel over `view`, a recording a lapsed account no longer plays, which it
 * cannot close: `LapsedGate` places it over the page body and makes the body inert, leaving
 * the page's header and navigation live. Subscribe opens the store's checkout at once. `error` is
 * the page's last failed action, which the body it covers cannot show.
 */
export function LapsedOverlay({
  view,
  onAction,
  error,
  from,
}: {
  /** The page's live recording. */
  view: RecordingView
  onAction: (action: PlanAction) => void
  error: string | null
  from: PremiumEntry
}) {
  const headlineId = useId()
  const bodyId = useId()
  const premium = usePremiumSheet()
  const settled = usePurchaseSettled()
  const { context } = usePlanContext('recordings', { recordingId: view.recording.id }, view)
  const offer = usePlanOffer(true, settled, (period) => void premium.checkout(period, from))
  const { chosen, price, primary } = offer
  useShownReport(from)
  return (
    <div
      className="absolute inset-0 z-10 flex justify-center overflow-y-auto px-4 pt-2 pb-4"
      style={{ backgroundColor: scrim(1) }}
    >
      <section
        aria-labelledby={headlineId}
        aria-describedby={context?.body ? bodyId : undefined}
        className="bg-page flex h-fit max-w-full flex-col gap-3 rounded-(--radius) p-4 shadow-(--shadow-float)"
        style={{ width: SHEET.width }}
      >
        <PlanPanel context={context} headlineId={headlineId} bodyId={bodyId} />
        <ErrorLine error={error} place="stack" />
        <div className="flex flex-col gap-3 pt-4">
          {/* An overlay raises no alert, so it says the store cannot answer in its line. */}
          {renderOfferChoice(offer, offer.unavailable ? SUBSCRIBE_UNAVAILABLE_TITLE : offer.line)}
          {primary && (
            <Button
              variant="primary"
              fullWidth
              size="large"
              label={primary.label}
              onPress={primary.onPress}
              isDisabled={primary.isDisabled}
            />
          )}
          <PlanExport context={context} onAction={onAction} />
          {chosen && price && <RenewalTerms price={price} period={chosen} />}
        </div>
      </section>
    </div>
  )
}

/** Sends `premium_sheet_shown` once per mount. */
function useShownReport(from: PremiumEntry) {
  const analytics = useAnalytics()
  const sent = useRef(false)
  useEffect(() => {
    if (sent.current) return
    sent.current = true
    analytics.send('premium_sheet_shown', { reason: 'recordings', from, presentation: 'overlay' })
  }, [analytics, from])
}
