import type { LucideIcon } from 'lucide-react'
import { Check } from 'lucide-react'
import { cloneElement, useCallback, useId, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  Menu as AriaMenu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Separator,
  Text,
  type Key,
  type PopoverProps,
} from 'react-aria-components'
import { useLatest } from './useLatest'
import { useStampedDensity } from '../platform/density'
import type { RowAction } from './Row'
import { OverlayClaim } from './overlayClaim'
import { Sheet } from './Sheet'

type Tone = NonNullable<RowAction['tone']>

/**
 * A menu item. Any row action is one; a menu item can also go without an icon, carry a
 * description under its label, be a choice the menu marks, or be disabled.
 */
export interface MenuEntry extends Omit<RowAction, 'icon' | 'shortLabel'> {
  icon?: LucideIcon
  description?: string
  /** Present on a choice; true while it is the one chosen. */
  checked?: boolean
  disabled?: boolean
}

/** How a menu's choices are marked: one of them, or each on its own. */
export type ChoiceMode = 'single' | 'multiple'

const TONE: Record<Tone, string> = {
  neutral: '',
  warning: 'text-warning',
  danger: 'text-danger',
}

/** Danger items go last so a stray tap lands on a harmless one; the rest keep their order. */
function partition(items: MenuEntry[], destructive: MenuEntry[]): [MenuEntry[], MenuEntry[]] {
  const marked = destructive.map((item) => ({ ...item, tone: 'danger' as const }))
  const all = [...items, ...marked]
  return [
    all.filter((item) => item.tone !== 'danger'),
    all.filter((item) => item.tone === 'danger'),
  ]
}

/** Items in order, with each run of adjacent choices gathered into one group. */
function runs(items: MenuEntry[]): (MenuEntry | MenuEntry[])[] {
  const out: (MenuEntry | MenuEntry[])[] = []
  for (const item of items) {
    const last = out.at(-1)
    if (item.checked === undefined) out.push(item)
    else if (Array.isArray(last)) last.push(item)
    else out.push([item])
  }
  return out
}

function MenuList({
  label,
  items,
  destructive = [],
  choiceMode = 'multiple',
  onDone,
  autoFocus,
}: {
  label: string
  items: MenuEntry[]
  destructive?: MenuEntry[]
  choiceMode?: ChoiceMode
  onDone: () => void
  autoFocus?: boolean
}) {
  const [main, danger] = partition(items, destructive)
  const menuId = useId()
  // React Aria's focus on open looks past the choice sections, where a chosen item lives, so
  // the first item to take focus hands it on to a single choice's chosen item, as a select's
  // does. Once per open: a choice that changes while open, such as by sync, leaves focus be.
  const chosen =
    autoFocus && choiceMode === 'single' ? main.find((item) => item.checked)?.id : undefined
  const chosenRef = useLatest(chosen)
  const menuRef = useCallback(
    (menu: HTMLDivElement | null) => {
      if (!menu) return
      const onFocusIn = (event: FocusEvent) => {
        const target = event.target as HTMLElement
        if (!target.matches('[role^="menuitem"]')) return
        menu.removeEventListener('focusin', onFocusIn)
        const key = chosenRef.current
        if (key === undefined) return
        const item = menu.querySelector<HTMLElement>(`[data-key="${CSS.escape(String(key))}"]`)
        // After this focus has finished its trip, or React Aria's handler for it, which runs
        // later, would take focus back.
        if (item && target !== item) queueMicrotask(() => item.focus())
      }
      menu.addEventListener('focusin', onFocusIn)
      return () => menu.removeEventListener('focusin', onFocusIn)
    },
    [chosenRef],
  )
  const run = (id: Key) => {
    ;[...main, ...danger].find((item) => item.id === id)?.onAction()
    onDone()
  }
  const renderItem = ({
    id,
    label: text,
    icon: Icon,
    tone = 'neutral',
    description,
    disabled,
  }: MenuEntry) => (
    <MenuItem
      key={id}
      id={id}
      textValue={text}
      isDisabled={disabled}
      className={`t-body data-[focused]:bg-fill data-[disabled]:text-ink-2 flex min-h-(--target) cursor-default items-center gap-3 rounded-(--radius-row) px-3 py-1 ${TONE[tone]}`}
    >
      {({ isSelected }) => (
        <>
          {Icon && <Icon className="size-5 shrink-0" aria-hidden />}
          {description ? (
            <span className="flex min-w-0 flex-1 flex-col">
              <Text slot="label">{text}</Text>
              <Text slot="description" className="t-secondary text-ink-2">
                {description}
              </Text>
            </span>
          ) : (
            <span className="min-w-0 flex-1">{text}</span>
          )}
          {isSelected && <Check className="text-action size-5 shrink-0" aria-hidden />}
        </>
      )}
    </MenuItem>
  )
  // A trigger labels its menu, which would name a sort menu for the current sort; pointing
  // aria-labelledby at the menu itself makes its own aria-label the name.
  return (
    <AriaMenu
      ref={menuRef}
      id={menuId}
      aria-label={label}
      aria-labelledby={menuId}
      autoFocus={autoFocus ? 'first' : undefined}
      onAction={run}
    >
      {runs(main).map((group) =>
        Array.isArray(group) ? (
          <MenuSection
            key={`choices-${group[0]!.id}`}
            selectionMode={choiceMode}
            selectedKeys={group.filter((item) => item.checked).map((item) => item.id)}
          >
            {group.map(renderItem)}
          </MenuSection>
        ) : (
          renderItem(group)
        ),
      )}
      {main.length > 0 && danger.length > 0 && <Separator className="bg-ink-2/25 my-1 h-px" />}
      {danger.map(renderItem)}
    </AriaMenu>
  )
}

function MenuPopover({ children, onClose, ...props }: PopoverProps & { onClose: () => void }) {
  return (
    <Popover
      {...props}
      className="bg-ground rounded-(--radius-surface) p-1 shadow-(--shadow-float)"
    >
      {(renderProps) => (
        <>
          <OverlayClaim close={onClose} />
          {typeof children === 'function' ? children(renderProps) : children}
        </>
      )}
    </Popover>
  )
}

function ActionSheet({
  isOpen,
  onClose,
  ...list
}: {
  isOpen: boolean
  onClose: () => void
  label: string
  items: MenuEntry[]
  destructive?: MenuEntry[]
  choiceMode?: ChoiceMode
}) {
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={list.label}
    >
      <MenuList {...list} onDone={onClose} autoFocus />
    </Sheet>
  )
}

/** What a touch menu sets on its trigger; a React Aria button takes all of it. */
export interface MenuTriggerProps {
  onPress?: () => void
  'aria-haspopup'?: boolean | 'menu' | 'dialog'
  'aria-expanded'?: boolean
}

/**
 * A menu of actions behind `trigger`: a popover on pointer, an action sheet with Cancel on
 * touch. `destructive` items follow a separator in the danger color. Items that carry
 * `checked` are choices, marked as `choiceMode` says.
 */
export function Menu({
  label,
  trigger,
  items,
  destructive = [],
  choiceMode,
  onClose,
}: {
  label: string
  trigger: ReactElement<MenuTriggerProps>
  items: MenuEntry[]
  destructive?: MenuEntry[]
  choiceMode?: ChoiceMode
  /** Called whenever the menu closes, by a choice or not. */
  onClose?: () => void
}) {
  const density = useStampedDensity()
  const [isOpen, setIsOpen] = useState(false)
  const setOpen = (open: boolean) => {
    setIsOpen(open)
    if (!open) onClose?.()
  }
  const close = () => setOpen(false)
  if (density === 'touch') {
    // Outside MenuTrigger, whose contexts would reach the menu inside the sheet.
    return (
      <>
        {cloneElement(trigger, {
          onPress: () => setOpen(true),
          'aria-haspopup': 'dialog',
          'aria-expanded': isOpen,
        })}
        <ActionSheet
          isOpen={isOpen}
          onClose={close}
          label={label}
          items={items}
          destructive={destructive}
          choiceMode={choiceMode}
        />
      </>
    )
  }
  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={setOpen}>
      {trigger}
      <MenuPopover placement="bottom end" onClose={close}>
        <MenuList
          label={label}
          items={items}
          destructive={destructive}
          choiceMode={choiceMode}
          onDone={close}
          autoFocus
        />
      </MenuPopover>
    </MenuTrigger>
  )
}

/**
 * The menu a row opens from a right-click, Shift+F10, or a touch long press: a popover at the
 * point on pointer, an action sheet on touch. Shown while `at` is set.
 */
export function MenuAtPoint({
  label,
  items,
  at,
  onClose,
}: {
  label: string
  items: RowAction[]
  at: { x: number; y: number } | null
  onClose: () => void
}) {
  const density = useStampedDensity()
  const triggerRef = useRef<HTMLSpanElement>(null)
  if (density === 'touch') {
    return <ActionSheet isOpen={at !== null} onClose={onClose} label={label} items={items} />
  }
  if (!at) return null
  return (
    <>
      {/* A real zero-size element at the point, since the popover observes its anchor's size. */}
      {/* Portaled so no transformed ancestor of the row re-bases its fixed position. */}
      {createPortal(
        <span
          ref={triggerRef}
          aria-hidden
          className="pointer-events-none fixed size-0"
          style={{ left: at.x, top: at.y }}
        />,
        document.body,
      )}
      <MenuPopover
        isOpen
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        triggerRef={triggerRef}
        placement="bottom start"
        onClose={onClose}
      >
        <MenuList label={label} items={items} onDone={onClose} autoFocus />
      </MenuPopover>
    </>
  )
}
