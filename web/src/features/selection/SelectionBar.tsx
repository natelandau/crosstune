import { ListChecks } from 'lucide-react'
import { animate, motion } from 'motion/react'
import {
  Fragment,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
// eslint-disable-next-line no-restricted-imports -- Phone bar cell with an icon over a caption, like a tab
import { Button as AriaButton, Toolbar } from 'react-aria-components'
import type { SelectionButton } from './selectionButton'
import { SELECTION_ACTIONS } from './selectionCopy'
import type { SelectionMode } from './useSelectionMode'
import { useSelectionTitle } from './useSelectionTitle'
import { DONE } from '../../ui/confirmCopy'
import { useLatest } from '../../ui/useLatest'
import { useFrame } from '../../platform/frame'
import { PaneBar } from '../../layout/PaneBar'
import { SelectionSlot } from '../../layout/selectionSlot'
import { Button } from '../../ui/Button'
import { IconButton } from '../../ui/IconButton'
import { ErrorLine } from '../../ui/ErrorLine'
import { ControlDescription, descriptionProps } from '../../ui/ControlDescription'
import { Menu, type MenuTriggerProps } from '../../ui/Menu'
import { menuEntries } from '../../ui/sharedActions'
import { PRESS, TINT_HOVER } from '../../ui/press'
import { UNFILLED_OFF } from '../../ui/buttonTone'
import { DURATION, EASE } from '../../theme/motion'

/** One cell of the phone's bar, drawn like a tab: the icon over its caption. */
function Cell({
  icon: Icon,
  label,
  caption = label,
  description,
  isDisabled,
  off,
  onPress,
  ...trigger
}: Pick<SelectionButton, 'icon' | 'label' | 'caption' | 'onPress'> &
  MenuTriggerProps & { description?: string; isDisabled: boolean; off: boolean }) {
  const descriptionId = useId()
  return (
    <AriaButton
      {...trigger}
      {...descriptionProps(descriptionId, description)}
      aria-label={caption === label ? undefined : label}
      aria-disabled={off || undefined}
      isDisabled={isDisabled}
      onPress={onPress}
      className={`t-caption text-primary flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-(--radius) ${UNFILLED_OFF} ${PRESS} ${TINT_HOVER}`}
    >
      <Icon className="size-6" aria-hidden />
      {caption}
      <ControlDescription id={descriptionId} text={description} />
    </AriaButton>
  )
}

/**
 * Fades in the controls of the pane bar in `pane`, so one bar swapping for another reads as a
 * change of mode.
 */
function fadeInBar(pane: Element | null) {
  // A phone root bar keeps its search under the row, so only the row swaps.
  const bar = pane?.querySelector(
    ':scope > [data-pane-bar], :scope > [data-root-bar] > [data-root-row]',
  )
  if (!bar) return
  // Its controls and title, never the bar's own background, which hides the rows scrolling under it.
  for (const part of bar.children) {
    void animate(part, { opacity: [0, 1] }, { duration: DURATION.short, ease: EASE })
  }
}

/**
 * The pane bar a screen wears while it selects: Select all leading, the count as the title, and
 * Done trailing. In a phone root bar it takes the title row's place. On pointer frames the
 * screen's `buttons` sit beside Done; on the phone they take the tab bar's place, in the same
 * order. Leaving by Done drops focus with the bar, so `restoreFocus` puts it back where
 * selecting began.
 */
export function SelectionBar({
  selection,
  noun,
  buttons,
  error = null,
  restoreFocus,
  inRootBar = false,
}: {
  selection: SelectionMode
  /** Counts what the rows are, such as "3 tunes", for the count read aloud. */
  noun: (n: number) => string
  buttons: readonly SelectionButton[]
  /** A failed action, shown under the bar. */
  error?: string | null
  restoreFocus: () => void
  /** Draws the controls as a bare row, in place of a phone root bar's title row. */
  inRootBar?: boolean
}) {
  const phone = useFrame() === 'phone'
  const slot = useContext(SelectionSlot)
  const { count, toggleAll } = selection.selection
  const words = useSelectionTitle(selection, noun)
  const none = count === 0
  const lead = useRef<HTMLSpanElement>(null)
  const restoreFocusRef = useLatest(restoreFocus)

  // In and out: the pane holding the bar outlasts it, so leaving can fade in the screen's own
  // bar once that commit has put it back.
  useLayoutEffect(() => {
    const pane = lead.current?.closest('[data-pane-bar], [data-root-bar]')?.parentElement ?? null
    fadeInBar(pane)
    return () => queueMicrotask(() => fadeInBar(pane))
  }, [])

  // A mode opened from More takes focus with it, since this bar replaced the menu's trigger.
  useEffect(() => {
    const focused = document.activeElement
    if (!focused || focused === document.body) lead.current?.querySelector('button')?.focus()
  }, [])

  // After the commit that brings the screen's own bar back, so its controls are there to take it.
  useEffect(
    () => () =>
      queueMicrotask(() => {
        const focused = document.activeElement
        if (!focused || focused === document.body) restoreFocusRef.current()
      }),
    [restoreFocusRef],
  )

  // A button with a reason is aria-disabled rather than disabled, so it keeps focus and its
  // tooltip, and the reason stays reachable. A menu's trigger takes its press from the menu.
  const control = (button: SelectionButton): ReactElement<MenuTriggerProps> => {
    const off = button.disabled !== undefined
    const onPress = button.menu || off ? undefined : button.onPress
    return phone ? (
      <Cell
        icon={button.icon}
        label={button.label}
        caption={button.caption}
        description={button.disabled}
        isDisabled={none}
        off={off}
        onPress={onPress}
      />
    ) : (
      <IconButton
        icon={button.icon}
        label={button.label}
        description={button.disabled}
        isDisabled={none}
        aria-disabled={off || undefined}
        onPress={onPress}
      />
    )
  }
  // A disabled menu goes unwrapped, since the menu would give its trigger a press that opens it.
  const controls = buttons.map((button) =>
    button.menu && button.disabled === undefined ? (
      <Menu
        key={button.id}
        label={button.label}
        trigger={control(button)}
        items={menuEntries(button.menu)}
      />
    ) : (
      <Fragment key={button.id}>{control(button)}</Fragment>
    ),
  )
  return (
    <>
      <PaneBar
        title={words.title}
        compactTitle={String(count)}
        titleAlways
        bare={inRootBar}
        leading={
          <span ref={lead} className="contents">
            {/* An icon on pointer, like the buttons beside Done, so the count keeps its width in
                the narrowest content column. */}
            {phone ? (
              <Button label={words.selectAllLabel} onPress={toggleAll} />
            ) : (
              <IconButton icon={ListChecks} label={words.selectAllLabel} onPress={toggleAll} />
            )}
          </span>
        }
        trailing={
          <>
            {!phone && controls}
            <Button label={DONE} onPress={selection.exit} />
          </>
        }
      />
      <p aria-live="polite" className="sr-only">
        {/* The region stays and its text is replaced, which is what a reader announces. */}
        <span key={count}>{words.spoken}</span>
      </p>
      <ErrorLine error={error} place="bar" />
      {phone &&
        slot &&
        createPortal(
          // Clipped, so the bar rises out of the foot of the screen into the tab bar's place.
          <div className="shrink-0 overflow-hidden">
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }}>
              <Toolbar
                aria-label={SELECTION_ACTIONS}
                className="bg-page border-default grid items-center border-t pb-[env(safe-area-inset-bottom)]"
                style={
                  buttons.length > 0
                    ? { gridTemplateColumns: `repeat(${buttons.length}, minmax(0, 1fr))` }
                    : undefined
                }
              >
                {controls}
              </Toolbar>
            </motion.div>
          </div>,
          slot,
        )}
    </>
  )
}
