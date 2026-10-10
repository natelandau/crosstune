import { Ellipsis, ListChecks, ListPlus, SquarePen, Tag, type LucideIcon } from 'lucide-react'
import { animate, motion } from 'motion/react'
import { useContext, useEffect, useLayoutEffect, useRef, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Button as AriaButton, Toolbar } from 'react-aria-components'
import type { Instrument } from '../../api/vocabulary'
import type { CatalogEntry } from '../catalog/filters'
import { ADD_TO_LIST, addTunesToListTitle } from '../lists/listPickerCopy'
import { EDIT_SELECTED, SET_STATUS, SELECTION_ACTIONS } from './selectionCopy'
import type { BulkActionsState, SelectionContext } from './useBulkActionsWith'
import type { SelectionMode } from './useSelectionMode'
import { useSelectionTitle } from './useSelectionTitle'
import { DONE } from '../../ui/confirmCopy'
import { MORE_ACTIONS } from '../../ui/menuCopy'
import { useLatest } from '../../ui/useLatest'
import { useFrame } from '../../platform/frame'
import { PaneBar } from '../../app/PaneBar'
import { SelectionSlot } from '../../app/selectionSlot'
import { Button } from '../../ui/Button'
import { ErrorLine } from '../../ui/ErrorLine'
import { Menu, type MenuTriggerProps } from '../../ui/Menu'
import { menuEntries } from '../../ui/sharedActions'
import { BulkEditSheet } from './BulkEditSheet'
import { ListPickerSheet } from './ListPickerSheet'
import { PRESS, WASH_HOVER } from '../../ui/press'
import { DURATION, EASE } from '../../theme/motion'

/** The More cell's caption on the phone's bar; its name stays `MORE_ACTIONS`. */
export const MORE_CAPTION = 'More'

interface Verb {
  icon: LucideIcon
  label: string
  /** The phone's caption, when shorter than the label it must start the label with. */
  caption?: string
}

/** One cell of the phone's bar, drawn like a tab: the icon over its caption. */
function Cell({
  icon: Icon,
  label,
  caption = label,
  isDisabled,
  onPress,
  ...trigger
}: Verb & MenuTriggerProps & { isDisabled: boolean }) {
  return (
    <AriaButton
      {...trigger}
      aria-label={caption === label ? undefined : label}
      isDisabled={isDisabled}
      onPress={onPress}
      className={`t-caption text-action flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-(--radius-row) disabled:opacity-40 ${PRESS} ${WASH_HOVER}`}
    >
      <Icon className="size-6" aria-hidden />
      {caption}
    </AriaButton>
  )
}

/** Fades in the controls of the pane bar in `pane`, so one bar swapping for another reads as a change of mode. */
function fadeInBar(pane: Element | null) {
  const bar = pane?.querySelector(':scope > [data-pane-bar]')
  if (!bar) return
  // Its controls and title, never the bar's own ground, which hides the rows scrolling under it.
  for (const part of bar.children) {
    void animate(part, { opacity: [0, 1] }, { duration: DURATION.short, ease: EASE })
  }
}

/**
 * The pane bar a screen wears while it selects: Select all leading, the count as the title, and
 * Done trailing. On pointer frames the bulk actions sit beside Done; on the phone they take the
 * tab bar's place: Set status, Edit, Add to list, then More, whose destructive items go last.
 * Leaving by Done drops focus with the bar, so `restoreFocus` puts it back where selecting began.
 */
export function SelectionBar({
  selection,
  actions,
  restoreFocus,
}: {
  selection: SelectionMode
  actions: BulkActionsState
  restoreFocus: () => void
}) {
  const phone = useFrame() === 'phone'
  const slot = useContext(SelectionSlot)
  const { count, total, toggleAll } = selection.selection
  const words = useSelectionTitle(count, total ?? 0)
  const none = count === 0
  const lead = useRef<HTMLSpanElement>(null)
  const restoreFocusRef = useLatest(restoreFocus)

  // In and out: the pane holding the bar outlasts it, so leaving can fade in the screen's own
  // bar once that commit has put it back.
  useLayoutEffect(() => {
    const pane = lead.current?.closest('[data-pane-bar]')?.parentElement ?? null
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

  const control = (verb: Verb, onPress?: () => void): ReactElement<MenuTriggerProps> =>
    phone ? (
      <Cell {...verb} isDisabled={none} onPress={onPress} />
    ) : (
      <Button icon={verb.icon} label={verb.label} iconOnly isDisabled={none} onPress={onPress} />
    )
  const verbs = (
    <>
      <Menu
        label={SET_STATUS}
        trigger={control({ icon: Tag, label: SET_STATUS })}
        items={menuEntries(actions.statusItems)}
      />
      {control({ icon: SquarePen, label: EDIT_SELECTED }, () => actions.setSheet('edit'))}
      {control({ icon: ListPlus, label: ADD_TO_LIST }, () => actions.setSheet('list'))}
      <Menu
        label={MORE_ACTIONS}
        trigger={control({ icon: Ellipsis, label: MORE_ACTIONS, caption: MORE_CAPTION })}
        items={menuEntries(actions.more)}
      />
    </>
  )
  return (
    <>
      <PaneBar
        title={words.title}
        compactTitle={String(count)}
        titleAlways
        leading={
          <span ref={lead} className="contents">
            {/* An icon on pointer, like the verbs beside Done, so the count keeps its width in
                the narrowest content column. */}
            <Button
              icon={phone ? undefined : ListChecks}
              label={words.selectAllLabel}
              iconOnly={!phone}
              onPress={toggleAll}
            />
          </span>
        }
        trailing={
          <>
            {!phone && verbs}
            <Button label={DONE} onPress={selection.exit} />
          </>
        }
      />
      <p aria-live="polite" className="sr-only">
        {/* The region stays and its text is replaced, which is what a reader announces. */}
        <span key={count}>{words.spoken}</span>
      </p>
      <ErrorLine error={actions.error} place="bar" />
      {phone &&
        slot &&
        createPortal(
          // Clipped, so the bar rises out of the foot of the screen into the tab bar's place.
          <div className="shrink-0 overflow-hidden">
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }}>
              <Toolbar
                aria-label={SELECTION_ACTIONS}
                className="bg-ground border-hairline grid grid-cols-4 items-center border-t pb-[env(safe-area-inset-bottom)]"
              >
                {verbs}
              </Toolbar>
            </motion.div>
          </div>,
          slot,
        )}
    </>
  )
}

/**
 * The sheets a selection's actions open, mounted whether or not the screen is selecting so
 * each closes in its own time after the action that ends the mode.
 */
export function BulkSheets({
  actions,
  entries,
  context,
  instruments,
}: {
  actions: BulkActionsState
  /** The selected tunes, in screen order. */
  entries: readonly CatalogEntry[]
  context: SelectionContext
  instruments: ReadonlySet<Instrument>
}) {
  return (
    <>
      <BulkEditSheet
        isOpen={actions.sheet === 'edit'}
        entries={entries}
        instruments={instruments}
        error={actions.edit.error}
        pending={actions.edit.pending}
        onCancel={() => actions.closeSheet('edit')}
        onApply={actions.edit.apply}
      />
      <ListPickerSheet
        isOpen={actions.sheet === 'list'}
        onOpenChange={(open) => {
          if (!open) actions.closeSheet('list')
        }}
        userTuneIds={actions.ids}
        excludeListId={context.kind === 'list' ? context.listId : undefined}
        title={addTunesToListTitle(actions.ids.length)}
        onAdded={actions.listAdded}
      />
    </>
  )
}
