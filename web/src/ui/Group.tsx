import { IonList } from '@ionic/react'
import type { ReactNode } from 'react'
import { InlineError } from './InlineError'
import { SectionHeader } from './SectionHeader'

/**
 * An inset group: header above, rows, then help text or an error below. Every child must be an
 * IonItem or a Row, since the separator rules find the first and last row by position.
 */
export function Group({
  header,
  name,
  footer,
  error,
  children,
}: {
  header?: ReactNode
  /** The list's own accessible name, for a screen whose groups have to be told apart. */
  name?: string
  footer?: ReactNode
  error?: string | null
  children: ReactNode
}) {
  return (
    <section>
      {header ? <SectionHeader>{header}</SectionHeader> : null}
      <IonList inset aria-label={name} className="my-0">
        {children}
      </IonList>
      {error ? (
        <InlineError className="px-5 pt-1.5">{error}</InlineError>
      ) : footer ? (
        <p className="type-footnote px-5 pt-1.5">{footer}</p>
      ) : null}
    </section>
  )
}
