import type { WorkingState } from './useWorking'

/** A button's accessible name while its work runs. */
export const WORKING = 'Working'

/** A button's accessible name once its work has finished. */
export const DONE = 'Done'

const STATUS: Record<WorkingState, string> = { idle: '', working: WORKING, done: DONE }

// A cross-fade, which reduced motion keeps.
export const FADE = 'transition-opacity duration-(--dur-fade) ease-(--ease)'

const OVERLAY = `absolute inset-0 grid place-items-center opacity-100 starting:opacity-0 ${FADE}`

/** The spinner or the check that covers a control while its work runs and after it ends. */
export function WorkingMark({ state }: { state: WorkingState }) {
  if (state === 'working')
    return (
      <span className={OVERLAY} aria-hidden>
        <span className="button-spinner" />
      </span>
    )
  if (state === 'done')
    return (
      <span className={OVERLAY} aria-hidden>
        <svg
          className="button-check size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    )
  return null
}

/**
 * A button's content is presentational to assistive technology, so the live region that
 * announces the work sits beside it. It stays mounted, empty when idle, so a reader hears each
 * change. A bare live region rather than role="status", so a screen's own status stays the one
 * status role in its part of the page.
 */
export function WorkingStatus({ state }: { state: WorkingState }) {
  return (
    <span aria-live="polite" aria-atomic="true" className="sr-only">
      {STATUS[state]}
    </span>
  )
}
