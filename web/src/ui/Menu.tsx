import {
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  useIonActionSheet,
  useIonPopover,
} from '@ionic/react'
import type { LucideIcon } from 'lucide-react'
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

export const MORE_ACTIONS = 'More actions'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  tone?: 'neutral' | 'warning' | 'error'
  onPress: () => void
}

// A tone is a text color on every menu, never a filled row: `color` on an ion-item paints its
// background, which reads as a selected item rather than a destructive one.
const TONE_CLASS = { neutral: undefined, warning: 'menu-warning', error: 'menu-danger' } as const

// useIonPopover takes the component it presents as an argument, so this one lives beside the
// hook that calls it rather than in its own file.
// eslint-disable-next-line react-refresh/only-export-components
function PopoverMenu({
  title,
  items,
  onDismiss,
}: {
  title: string
  items: MenuItem[]
  onDismiss: () => void
}) {
  const firstDestructive = items.findIndex((item) => item.tone === 'error')
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
              className={TONE_CLASS[item.tone ?? 'neutral']}
              onClick={() => {
                onDismiss()
                item.onPress()
              }}
            >
              <IonLabel>{item.label}</IonLabel>
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
  // Stable for the component's life, so componentProps only changes identity when the items
  // it shows actually change; the effect below keeps the dismiss it calls current.
  const onDismiss = useCallback(() => dismissRef.current(), [])
  const popoverProps = useMemo(() => ({ ...menu, onDismiss }), [menu, onDismiss])
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
              // rejects still releases the next menu.
              const release = () => setTimeout(dismissed)
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
        waitForDismiss((onDidDismiss) =>
          presentSheet({
            header: title,
            onDidDismiss,
            buttons: [
              ...nextItems.map((item, index) => {
                const classes = [
                  TONE_CLASS[item.tone ?? 'neutral'],
                  index === firstDestructive ? 'menu-destructive' : null,
                ].filter((name): name is string => name !== null && name !== undefined)
                return {
                  text: item.label,
                  role: item.tone === 'error' ? ('destructive' as const) : undefined,
                  cssClass: classes.length > 0 ? classes : undefined,
                  handler: item.onPress,
                }
              }),
              { text: 'Cancel', role: 'cancel' },
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
