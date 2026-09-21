import { IonList } from '@ionic/react'
import type { ReactNode } from 'react'
import { InlineError } from './InlineError'
import { SectionHeader } from './SectionHeader'

/**
 * A section of a grouped screen or form: a header, then the rows, then help text or an error.
 * It owns every vertical space around itself, so no caller adds a margin of its own and one
 * scale holds across every screen. A headed section stands further from what precedes it than
 * its header does from its own rows, which is what makes the header read as those rows'.
 *
 * The header props pass through to `SectionHeader`, which sets what a header at each role reads
 * like and where it may lead.
 *
 * Every child of a card must be an IonItem or a Row, since the separator rules find the first
 * and last row by position.
 */
export function Group({
  header,
  headerNames = false,
  actions,
  onHeaderOpen,
  headerOpenName,
  name,
  footer,
  error,
  plain = false,
  children,
}: {
  header?: ReactNode
  /** Marks a header that names what its rows belong to rather than labeling a section. */
  headerNames?: boolean
  /** Controls at the header's trailing edge, for adding to what the header names. A header
   * that opens what it names has no room for them and drops them; see SectionHeader. */
  actions?: ReactNode
  /** Opens what a naming header names. */
  onHeaderOpen?: () => void
  /** The verb that control takes, read before the header's own name: "Open". */
  headerOpenName?: string
  /** The list's own accessible name, for a screen whose groups have to be told apart. */
  name?: string
  footer?: ReactNode
  error?: string | null
  /**
   * Renders the children straight onto the grouped background instead of inside a card, for a
   * control that is not a list: a grid of pills, a rail of chips. Header, footer, and
   * spacing are identical, so a bare block and a card can never drift apart.
   */
  plain?: boolean
  children: ReactNode
}) {
  const opening =
    onHeaderOpen && headerOpenName !== undefined
      ? ({ onOpen: onHeaderOpen, openName: headerOpenName } as const)
      : {}
  return (
    <section className={header ? 'pt-(--form-section-gap)' : 'pt-(--form-gutter)'}>
      {header ? (
        <SectionHeader names={headerNames} actions={actions} {...opening}>
          {header}
        </SectionHeader>
      ) : null}
      {plain ? (
        children
      ) : (
        <IonList inset aria-label={name}>
          {children}
        </IonList>
      )}
      {error ? (
        <InlineError className="px-(--form-inset) pt-(--form-text-gap)">{error}</InlineError>
      ) : footer ? (
        <p className="type-footnote px-(--form-inset) pt-(--form-text-gap)">{footer}</p>
      ) : null}
    </section>
  )
}
