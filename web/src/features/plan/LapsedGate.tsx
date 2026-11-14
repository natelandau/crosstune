import type { ReactNode } from 'react'
import { useRecordingsPlayable } from '../../billing/usePlan'
import type { PremiumEntry } from '../../usage/events'
import type { RecordingView } from '../recordings/useRecordings'
import { LapsedOverlay } from './LapsedOverlay'
import type { PlanAction } from './planCopy'

/**
 * A recording page's body, covered by the Plan overlay while the plan plays no recordings: the
 * body goes inert under the overlay, and the page's `error` shows on the overlay instead. The
 * body renders with the error it shows, null while covered.
 */
export function LapsedGate({
  view,
  error,
  onAction,
  from,
  className,
  children,
}: {
  /** The page's live recording; the overlay waits for it. */
  view: RecordingView | null
  error: string | null
  onAction: (action: PlanAction) => void
  from: PremiumEntry
  /** The body's own layout, which both wrappers pass through. */
  className: string
  children: (bodyError: string | null) => ReactNode
}) {
  const plays = useRecordingsPlayable()
  return (
    <div className={`relative isolate ${className}`}>
      <div
        inert={!plays}
        // Its own stacking context, so nothing inside it, such as the zoom over the waveform,
        // draws over the overlay.
        className={`${className} ${plays ? '' : 'relative z-0'}`}
      >
        {children(plays ? error : null)}
      </div>
      {view && !plays && (
        <LapsedOverlay view={view} onAction={onAction} error={error} from={from} />
      )}
    </div>
  )
}
