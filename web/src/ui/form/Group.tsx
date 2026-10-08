import { useId, type ReactNode } from 'react'
import { ErrorLine } from '../ErrorLine'

/**
 * A form section: an optional header naming the group, its rows in one inset card, then help
 * text, which a validation message replaces in the danger color.
 */
export function Group({
  header,
  footer,
  error,
  errorId,
  plain = false,
  children,
}: {
  header?: string
  footer?: string
  error?: string
  /** The error's id, for a field that names it as its description. */
  errorId?: string
  /** Sets the rows on the ground with no card, for a control that is not a list of rows. */
  plain?: boolean
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={header ? id : undefined} className={header ? 'pt-6' : 'pt-4'}>
      {header && (
        <h3 id={id} className="t-secondary text-ink-2 px-4 pb-2">
          {header}
        </h3>
      )}
      {plain ? (
        children
      ) : (
        <div className="bg-fill flex flex-col rounded-(--radius-surface)">{children}</div>
      )}
      {error ? (
        <ErrorLine id={errorId} error={error} place="field" />
      ) : (
        footer && <p className="t-secondary text-ink-2 px-4 pt-2">{footer}</p>
      )}
    </section>
  )
}
