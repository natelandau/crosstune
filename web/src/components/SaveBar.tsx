import { ErrorText } from './Page'

/**
 * The form's actions, fixed above the dock and the player so Save is reachable without
 * scrolling. Save stays enabled through validation; only an in-flight write disables it.
 * A rejected write reports here, where the action was started, not down the page.
 */
export function SaveBar({
  submitLabel,
  pending,
  error,
  onCancel,
}: {
  submitLabel: string
  pending: boolean
  error?: string | null
  onCancel?: () => void
}) {
  return (
    <div className="bg-base-100 border-base-content/10 fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+var(--player-dock-offset,var(--dock-cap)))] z-10 border-t">
      {error ? (
        <div className="mx-auto w-full max-w-(--measure) px-4 pt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
      <div className="mx-auto flex w-full max-w-(--measure) gap-2 px-4 py-2">
        <button type="submit" className="btn btn-primary min-h-11 flex-1" disabled={pending}>
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn min-h-11" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  )
}
