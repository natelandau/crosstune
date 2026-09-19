import {
  IonButton,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonRippleEffect,
} from '@ionic/react'
import { Circle, CircleCheck, type LucideIcon } from 'lucide-react'
import { useId, useRef, type ReactNode } from 'react'
import { getMode } from '../platform/mode'
import { usePointer } from '../platform/pointer'
import { useLongPress } from './longPress'

export interface RowAction {
  /** Names the action to assistive technology, as "<label> <row name>". */
  label: string
  /**
   * The text the swipe button shows in place of the label, for a label too long to read at the
   * one width every swipe action is revealed at. The label still names the control.
   */
  short?: string
  icon: LucideIcon
  tone: 'neutral' | 'warning' | 'error'
  onPress: () => void
}

const COLOR = { neutral: 'medium', warning: 'warning', error: 'danger' } as const

// Matches a light-DOM control a click can land on; used to tell a control's own tap
// from a tap on the row around it.
const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, [role="button"], ion-button, ion-toggle, ion-checkbox'

/**
 * The one list row. Without `openName`, on touch the item itself is Ionic's own native button
 * and a swipe reveals the actions as full-height buttons; on a mouse the item holds a full-row
 * button beside which, rather than inside it, the actions show on hover and on focus. With
 * `openName`, the row opens through one explicit button on both pointers instead, because
 * `ion-item` wraps `start`, the body, and `end` together inside its own native button, and a
 * verb whose name changes over time cannot ride `ion-item`'s `aria-label`, which it forwards
 * only as a snapshot taken once as it loads. That one button sits in the start slot, whose
 * containing block is the item's own native element rather than the inner wrapper that begins
 * after the leading padding and the glyph, so every point of the row opens it; it composes its
 * name from the verb plus the row's own content, and `end`'s own control, such as Retry, keeps
 * its own name rather than being read as part of the open control's. Nothing in `start` or the
 * body is hidden from either pointer's accessibility tree.
 *
 * Whatever `end` holds is treated as a control and stacked above the open control, so an inert
 * `end`, a badge or a note, belongs only on a row that does not open; on one that does, it would
 * sit over the open control and swallow the taps meant for it. A `note` carries inert content.
 */
export function Row({
  name,
  onOpen,
  openName,
  actions = [],
  disabled = false,
  dimmed = false,
  selected,
  openId,
  onLongPress,
  start,
  end,
  children,
  note,
}: {
  /** The item's title; each action is named "<label> <name>". */
  name: string
  /** Opens the item. A row without it is not clickable. */
  onOpen?: () => void
  /**
   * A verb prefixed to the row's own content to name the open control, for a control whose
   * action and name change over time (play versus close, for example). It renders as ordinary
   * content, so the computed name stays reactive on every render. Requires `onOpen`: a name for
   * a control that does not exist is a contradiction, so passing one without the other throws.
   */
  openName?: string
  actions?: readonly RowAction[]
  /** True while selecting: no swipe and no hover actions. */
  disabled?: boolean
  /** Dims the whole row, for an archived item. */
  dimmed?: boolean
  /**
   * Present while selecting: the row's open control becomes a checkbox and a check mark
   * renders on the leading edge. Undefined outside selection, so a row that never selects
   * keeps its button role.
   */
  selected?: boolean
  /**
   * The id put on the open control, so something outside the row can move focus to it. Nothing
   * else in the row takes it: the open control is what carries the row's role and its state.
   */
  openId?: string
  /** Enters selection on touch. Never wired on a mouse, which has the Select control instead. */
  onLongPress?: () => void
  start?: ReactNode
  end?: ReactNode
  /** An interactive control belongs in end, not here: with `openName` set, the whole row opens
   * through its own button, so a control nested in the body would be a control inside a
   * control, and `start` must hold no control either for the same reason. */
  children: ReactNode
  /** Content that stays part of the row without naming its open control, such as an error line
   * or a link out to another site: visible and in the accessibility tree on its own, but left
   * out of `openName`'s composed name, which reads only the verb and the title and meta content
   * above it. A control here is a sibling of the open control rather than nested in it, so
   * unlike one in the body it is allowed, and it takes its own taps back from the row. */
  note?: ReactNode
}) {
  if (openName !== undefined && !onOpen) {
    throw new Error('Row: openName requires onOpen')
  }
  const pointer = usePointer()
  const slidingRef = useRef<HTMLIonItemSlidingElement>(null)
  const contentId = useId()
  const verbId = useId()
  const showActions = actions.length > 0 && !disabled
  const named = openName !== undefined
  const selecting = selected !== undefined
  const press = useLongPress(onLongPress)
  // ion-item wraps start, body, and end together inside its own native button, so a named open
  // control (whose end may hold a real Retry or grip button) opens through its own explicit
  // button instead: an element beside end, not a wrapper around it, so end's own name stays
  // its own. A mouse always opens this way, since it needs a button separate from the actions
  // that only show on hover. Selecting opens this way too: the check mark and the open control
  // have to be siblings in the start slot.
  const useOverlay = Boolean(onOpen) && (pointer === 'mouse' || named || selecting)
  // The row-link hooks apply the CSS this open control's focus ring and hover surface draw on;
  // without it, ion-item and its shadow content clip the overlay button's own outline.
  const itemClassName = useOverlay
    ? pointer === 'mouse'
      ? 'row-link group'
      : 'row-link'
    : undefined
  const body = (
    <div
      // Clicks pass through the content to the open button beneath it, whichever renders one.
      className={`min-w-0 flex-1 ${useOverlay ? 'pointer-events-none' : ''} ${dimmed ? 'opacity-60' : ''}`}
    >
      {named ? (
        <span id={verbId} className="sr-only">
          {openName}
        </span>
      ) : null}
      <div id={contentId}>{children}</div>
      {note ? <div className="row-note">{note}</div> : null}
    </div>
  )
  // ion-item is Ionic's own activatable only while it is its own button, so a row that opens
  // through this one instead has to carry the press feedback itself.
  const pressable = useOverlay && pointer === 'touch'
  // An item ripples in md alone; in ios a press is the tint by itself, so a row that ripples
  // there would answer a finger differently from every row beside it.
  const ripples = pressable && getMode() === 'md'
  const overlay = useOverlay ? (
    <button
      type="button"
      // The start slot renders as a direct child of the item's native element, so this button
      // resolves against the whole row rather than the inner wrapper the body sits in.
      slot="start"
      id={openId}
      data-row-open
      aria-labelledby={named ? `${verbId} ${contentId}` : contentId}
      role={selecting ? 'checkbox' : undefined}
      aria-checked={selecting ? selected : undefined}
      className={pressable ? 'row-open ion-activatable' : 'row-open'}
      onClick={onOpen}
    >
      {ripples ? <IonRippleEffect /> : null}
    </button>
  ) : null
  // Inert decoration: the open control above it carries the checkbox role and its state. The
  // empty mark is a wash of the row's own ink, so it follows the palette into dark mode; half
  // is what clears the 3:1 a state indicator needs against the row under it.
  const check = selecting ? (
    <span slot="start" data-row-check className="pointer-events-none flex size-6 items-center">
      {selected ? (
        <CircleCheck aria-hidden="true" className="size-6 text-(--ion-color-primary)" />
      ) : (
        <Circle aria-hidden="true" className="size-6 opacity-50" />
      )}
    </span>
  ) : null

  if (pointer === 'touch') {
    const item = (
      <IonItem
        button={Boolean(onOpen) && !useOverlay}
        detail={false}
        className={itemClassName}
        onClick={(event) => {
          if (!onOpen || useOverlay) return
          const target = event.target as HTMLElement
          // A control anywhere in the row already handled its own tap; opening the row too
          // would fire both handlers for one tap.
          if (target.closest(INTERACTIVE_SELECTOR)) return
          onOpen()
        }}
        {...press}
      >
        {overlay}
        {check}
        {start}
        {body}
        {end ? (
          <div slot="end" className="row-trailing">
            {end}
          </div>
        ) : null}
      </IonItem>
    )
    if (!showActions) return item
    return (
      <IonItemSliding ref={slidingRef}>
        {item}
        <IonItemOptions side="end">
          {actions.map((action) => (
            <IonItemOption
              key={action.label}
              color={COLOR[action.tone]}
              onClick={() => {
                // An action that leaves the row in place must not leave its options revealed.
                void slidingRef.current?.close()
                action.onPress()
              }}
            >
              <span
                aria-hidden
                className="flex w-full flex-col items-center gap-1 text-center text-xs"
              >
                <action.icon aria-hidden className="size-6" />
                {action.short ?? action.label}
              </span>
              <span className="sr-only">{`${action.label} ${name}`}</span>
            </IonItemOption>
          ))}
        </IonItemOptions>
      </IonItemSliding>
    )
  }

  return (
    <IonItem detail={false} className={itemClassName ?? 'group'}>
      {overlay}
      {check}
      {start}
      {body}
      {showActions || end ? (
        <div slot="end" className="row-trailing">
          {showActions ? (
            <div className="row-actions">
              {actions.map((action) => (
                <IonButton
                  key={action.label}
                  fill="clear"
                  color={COLOR[action.tone]}
                  aria-label={`${action.label} ${name}`}
                  className="row-action"
                  onClick={action.onPress}
                >
                  <action.icon aria-hidden className="size-5" />
                </IonButton>
              ))}
            </div>
          ) : null}
          {end}
        </div>
      ) : null}
    </IonItem>
  )
}
