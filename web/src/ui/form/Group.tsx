import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react'
import { Children, isValidElement, useId, type ReactNode, type Ref } from 'react'
import { DURATION, EASE, SPRING } from '../../theme/motion'
import { ErrorLine } from '../ErrorLine'
import { useSubheadingLevel } from '../headingLevel'
import { InRow } from '../inRow'

/** A group's card: its rows on one surface, a hairline between each. */
export const GROUP_CARD = 'group-rows bg-surface flex flex-col rounded-(--radius)'

/**
 * A form section: an optional header naming the group, its rows in one inset card, then help
 * text, which a validation message replaces in the danger color. A settings group sets `help`
 * instead of `footer`, which leads the rows and stays when a message shows below them.
 */
export function Group({
  id,
  header,
  footer,
  help,
  error,
  errorId,
  plain = false,
  headerRef,
  animateRows = false,
  children,
}: {
  /** The section's id, for an address that lands on this group. */
  id?: string
  header?: string
  footer?: string
  /** Help shown above the rows, for a settings group. */
  help?: ReactNode
  error?: string
  /** The error's id, for a field that names it as its description. */
  errorId?: string
  /** Sets the rows on the page with no card, for a control that is not a list of rows. */
  plain?: boolean
  /** Makes the header focusable from code, for a step that moves focus to it as it shows. */
  headerRef?: Ref<HTMLHeadingElement>
  /** Opens a row added by key and closes a removed one, so the rows below never jump. */
  animateRows?: boolean
  children: ReactNode
}) {
  const headerId = useId()
  const Header = `h${useSubheadingLevel()}` as const
  return (
    <section
      id={id}
      aria-labelledby={header ? headerId : undefined}
      // Clears the sticky pane bar when an address scrolls the group to the top.
      className={`scroll-mt-14 ${header ? 'pt-6' : 'pt-4'}`}
    >
      {header && (
        <Header
          id={headerId}
          ref={headerRef}
          tabIndex={headerRef ? -1 : undefined}
          className="t-secondary text-secondary px-4 pb-2"
        >
          {header}
        </Header>
      )}
      {help && <p className="t-secondary text-secondary px-4 pb-2">{help}</p>}
      {plain ? (
        children
      ) : (
        // The hairlines between rows and the rows' corners are in controls.css.
        <div className={GROUP_CARD}>
          <InRow.Provider value={true}>
            {animateRows ? <AnimatedRows>{children}</AnimatedRows> : children}
          </InRow.Provider>
        </div>
      )}
      {error ? (
        <ErrorLine id={errorId} error={error} place="field" />
      ) : (
        footer && <p className="t-secondary text-secondary px-4 pt-2">{footer}</p>
      )}
    </section>
  )
}

/** Each keyed row opens its space on the spring and fades in, and fades and closes as it leaves. */
function AnimatedRows({ children }: { children: ReactNode }) {
  // Under reduced motion a row only fades, and its space opens and closes at once.
  const reduceMotion = useReducedMotionConfig() ?? false
  // Clipped only while it moves, so a focus ring outside the row still shows at rest.
  const closed = reduceMotion
    ? { opacity: 0 }
    : { opacity: 0, height: 0, overflow: 'hidden' as const }
  return (
    <AnimatePresence initial={false}>
      {Children.toArray(children).map((child) => (
        <motion.div
          key={isValidElement(child) ? child.key : undefined}
          initial={closed}
          animate={{
            opacity: 1,
            height: 'auto',
            transitionEnd: { overflow: 'visible' },
            transition: reduceMotion
              ? { duration: DURATION.short, ease: EASE }
              : { height: SPRING, opacity: SPRING },
          }}
          exit={{ ...closed, transition: { duration: DURATION.short, ease: EASE } }}
          // The first and last rows keep the card's corners.
          className="*:rounded-[inherit]"
        >
          {child}
        </motion.div>
      ))}
    </AnimatePresence>
  )
}
