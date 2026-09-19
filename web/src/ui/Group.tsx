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
 * Every child of a card must be an IonItem or a Row, since the separator rules find the first
 * and last row by position.
 */
export function Group({
  header,
  name,
  footer,
  error,
  plain = false,
  children,
}: {
  header?: ReactNode
  /** The list's own accessible name, for a screen whose groups have to be told apart. */
  name?: string
  footer?: ReactNode
  error?: string | null
  /**
   * Renders the children straight onto the grouped background instead of inside a card, for a
   * control that is not a list: a segmented control, a rail of pills. Header, footer, and
   * spacing are identical, so a bare block and a card can never drift apart.
   */
  plain?: boolean
  children: ReactNode
}) {
  return (
    <section className={header ? 'pt-6' : 'pt-4'}>
      {header ? <SectionHeader>{header}</SectionHeader> : null}
      {plain ? (
        children
      ) : (
        <IonList inset aria-label={name} className="my-0">
          {children}
        </IonList>
      )}
      {error ? (
        <InlineError className="px-8 pt-2">{error}</InlineError>
      ) : footer ? (
        <p className="type-footnote px-8 pt-2">{footer}</p>
      ) : null}
    </section>
  )
}
