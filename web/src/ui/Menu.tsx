import {
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  useIonActionSheet,
  useIonPopover,
} from '@ionic/react'
import { Check, type LucideIcon } from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { usePointer } from '../platform/pointer'
import { CANCEL } from './Confirm'
import { iconPairSource, iconSource } from './iconSource'
import { DISABLED_ITEM } from './menuCopy'

export const MORE_ACTIONS = 'More actions'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  tone?: 'neutral' | 'warning' | 'error'
  /** Why the item cannot be used right now; it stays in the menu, disabled, with this reason. */
  disabled?: string
  /**
   * Why the item cannot run now. It keeps its name and its tap, shows this under its label, and
   * a tap leaves the menu open and runs nothing, the way a control that needs the network
   * refuses offline rather than disabling.
   */
  refused?: string
  /**
   * Runs during the tap, while the menu is still up, rather than once it has dismissed. A
   * browser lets a page open a tab only while it handles a tap, and the dismissal outlasts that.
   */
  opensTab?: boolean
  /**
   * Marks the item as the current choice. A menu where any item defines it is a single-choice
   * menu: the checked item carries a check, and choosing it still runs its `onPress`.
   */
  checked?: boolean
  /**
   * Words assistive technology reads after the label, for a state the item's icon shows, such
   * as the direction of the current sort.
   */
  description?: string
  onPress: () => void
}

// A tone is a text color on every menu, never a filled row: `color` on an ion-item paints its
// background, which reads as a selected item rather than a destructive one.
const TONE_CLASS = { neutral: undefined, warning: 'menu-warning', error: 'menu-danger' } as const

const CHOICE_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End'])

/**
 * Moves focus among a single-choice popover's items the way Ionic's popover does among its
 * ion-items, which are all it handles: no wrapping, and disabled items are skipped.
 */
function moveAmongChoices(event: KeyboardEvent, menu: HTMLElement) {
  if (!CHOICE_KEYS.has(event.key)) return
  event.preventDefault()
  const choices = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].filter(
    (choice) => !choice.disabled,
  )
  const index = choices.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    event.key === 'Home'
      ? choices[0]
      : event.key === 'End'
        ? choices.at(-1)
        : event.key === 'ArrowDown'
          ? choices[index + 1]
          : index > 0
            ? choices[index - 1]
            : undefined
  next?.focus()
}

// useIonPopover takes the component it presents as an argument, so this one lives beside the
// hook that calls it rather than in its own file.
// eslint-disable-next-line react-refresh/only-export-components
function PopoverMenu({
  title,
  items,
  onChoose,
}: {
  title: string
  items: MenuItem[]
  onChoose: (item: MenuItem) => void
}) {
  const firstDestructive = items.findIndex((item) => item.tone === 'error')
  const singleChoice = items.some((item) => item.checked !== undefined)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!singleChoice) return
    // On the document rather than the menu, since the popover opens with focus on itself
    // and the first ArrowDown has to reach the items from there.
    const onKeyDown = (event: KeyboardEvent) => {
      const menu = menuRef.current
      const host = menu?.closest('ion-popover')
      if (menu && host?.contains(event.target as Node)) moveAmongChoices(event, menu)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [singleChoice])
  if (singleChoice) {
    // Native buttons, not ion-items: the radio state has to sit on the element that takes
    // focus, and an ion-item keeps its button inside a shadow root.
    return (
      <div ref={menuRef} role="menu" aria-label={title} className="py-2">
        {items.map((item, index) => {
          const reason = item.disabled ?? item.refused
          return (
            <Fragment key={item.label}>
              {index === firstDestructive ? (
                <div role="separator" className="menu-choice-separator" />
              ) : null}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!!item.checked}
                disabled={!!item.disabled}
                aria-description={item.description}
                className={`menu-choice type-body flex min-h-11 w-full items-center gap-3 px-4 py-2 text-start disabled:opacity-50 ${TONE_CLASS[item.tone ?? 'neutral'] ?? ''}`}
                onClick={() => {
                  if (!item.disabled && !item.refused) onChoose(item)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span data-menu-label>{item.label}</span>
                  {reason ? (
                    <span className="type-footnote block text-(--ion-color-medium)">{reason}</span>
                  ) : null}
                </span>
                {item.icon ? <item.icon aria-hidden className="size-4 shrink-0" /> : null}
                {item.checked ? <Check aria-hidden className="size-5 shrink-0" /> : null}
              </button>
            </Fragment>
          )
        })}
      </div>
    )
  }
  return (
    // The action sheet shows the title as its header; a popover has nowhere to show it, so the
    // group carries it as the name of the choices it holds.
    <div role="group" aria-label={title}>
      <IonList lines="none">
        {items.map((item, index) => (
          <Fragment key={item.label}>
            {index === firstDestructive ? <IonItemDivider className="menu-divider" /> : null}
            <IonItem
              button
              detail={false}
              disabled={!!item.disabled}
              className={TONE_CLASS[item.tone ?? 'neutral']}
              onClick={() => {
                if (!item.disabled && !item.refused) onChoose(item)
              }}
            >
              <IonLabel>
                <span data-menu-label>{item.label}</span>
                {item.disabled || item.refused ? <p>{item.disabled ?? item.refused}</p> : null}
              </IonLabel>
              {item.icon ? <item.icon aria-hidden className="size-5" slot="end" /> : null}
            </IonItem>
          </Fragment>
        ))}
      </IonList>
    </div>
  )
}

/**
 * An action sheet on touch and a popover anchored to the button on mouse. A destructive item
 * is red and follows a separator; a cautionary one takes the warning color in both.
 */
export function useMenu(): (
  event: MouseEvent | ReactMouseEvent,
  title: string,
  items: MenuItem[],
) => void {
  const pointer = usePointer()
  const [presentSheet] = useIonActionSheet()

  const [menu, setMenu] = useState<{ title: string; items: MenuItem[] }>({ title: '', items: [] })
  const dismissRef = useRef<() => void>(() => {})
  // The item picked from the open menu. It runs once the menu has finished dismissing, never
  // while the menu is still up: an action that presents a sheet would otherwise overlap the
  // menu, and with two overlays presented at once Ionic cannot tell which dismissal should give
  // the page back to assistive technology, so the screen stays hidden from it.
  const chosen = useRef<(() => void) | null>(null)
  const runChosen = () => {
    const action = chosen.current
    chosen.current = null
    action?.()
  }
  // Stable for the component's life, so componentProps only changes identity when the items
  // it shows actually change; the effect below keeps the dismiss it calls current.
  const onChoose = useCallback((item: MenuItem) => {
    if (item.opensTab) item.onPress()
    else chosen.current = item.onPress
    dismissRef.current()
  }, [])
  const popoverProps = useMemo(() => ({ ...menu, onChoose }), [menu, onChoose])
  const [presentPopover, dismissPopover] = useIonPopover(PopoverMenu, popoverProps)

  useEffect(() => {
    dismissRef.current = () => void dismissPopover()
  }, [dismissPopover])

  // Ionic's present hooks silently ignore a call while their previous overlay is still
  // dismissing, so a menu opened from another menu's item would never appear. Each open waits
  // for the menu before it to finish dismissing.
  const previous = useRef(Promise.resolve())

  return useCallback(
    (event, title, nextItems) => {
      const waitForDismiss = (present: (onDidDismiss: () => void) => unknown) => {
        previous.current = previous.current.then(
          () =>
            new Promise<void>((dismissed) => {
              // The macrotask lets React commit the closed overlay before the next present,
              // or the popover reopens with no content mounted. A present that throws or
              // rejects still releases the next menu. The chosen item runs in the same step,
              // once Ionic has hidden the menu and dropped it from the page, so a sheet it
              // opens never overlaps the menu.
              const release = () =>
                setTimeout(() => {
                  dismissed()
                  runChosen()
                })
              Promise.resolve()
                .then(() => present(release))
                .catch(release)
            }),
        )
      }
      if (pointer === 'touch') {
        // A top border on the first destructive item marks the boundary, since the action sheet
        // only groups its own cancel button natively.
        const firstDestructive = nextItems.findIndex((item) => item.tone === 'error')
        // A sheet's button holds one line of text, so the reasons sit under the header instead.
        const refusals = nextItems.flatMap((item) => (item.refused ? [item.refused] : []))
        waitForDismiss((onDidDismiss) =>
          presentSheet({
            header: title,
            subHeader: refusals.length > 0 ? [...new Set(refusals)].join(' ') : undefined,
            onDidDismiss,
            buttons: [
              ...nextItems.map((item, index) => {
                const pairedIcon = item.checked && item.icon
                const classes = [
                  TONE_CLASS[item.tone ?? 'neutral'],
                  index === firstDestructive ? 'menu-destructive' : null,
                  pairedIcon ? 'menu-icon-pair' : null,
                ].filter((name): name is string => name !== null && name !== undefined)
                const description = [item.description, item.refused].filter(Boolean).join(' ')
                return {
                  text: item.disabled ? DISABLED_ITEM(item.label, item.disabled) : item.label,
                  disabled: !!item.disabled,
                  icon: pairedIcon
                    ? iconPairSource(pairedIcon, Check)
                    : item.checked
                      ? iconSource(Check)
                      : item.icon
                        ? iconSource(item.icon)
                        : undefined,
                  role: item.tone === 'error' ? ('destructive' as const) : undefined,
                  cssClass: classes.length > 0 ? classes : undefined,
                  // Current, not a radio: Ionic moves a radio's checked state with the arrow keys
                  // without running its handler, announcing a choice nobody made.
                  htmlAttributes: {
                    ...(description ? { 'aria-description': description } : {}),
                    ...(item.checked ? { 'aria-current': 'true' } : {}),
                  },
                  // False keeps the sheet up, so a refused tap leaves the reason in view.
                  handler: () => {
                    if (item.refused) return false
                    if (item.opensTab) item.onPress()
                    else chosen.current = item.onPress
                  },
                }
              }),
              { text: CANCEL, role: 'cancel' },
            ],
          }),
        )
        return
      }
      waitForDismiss((onDidDismiss) => {
        // A fresh object, even for a caller's memoized items, so React always treats this as a
        // change and the popover always reopens.
        setMenu({ title, items: [...nextItems] })
        return presentPopover({ event: event as MouseEvent, onDidDismiss })
      })
    },
    [pointer, presentSheet, presentPopover],
  )
}
