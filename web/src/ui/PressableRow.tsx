import { ArrowUpRight, Check, ChevronRight } from 'lucide-react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  type ButtonProps as AriaButtonProps,
} from 'react-aria-components'
import { Link, type LinkProps } from 'react-router'
import { FIELD_ROW_PRESSABLE } from './form/FieldRow'
import { PRESS, ROW_PRESS } from './press'

export type PressableRowVariant = 'field' | 'list' | 'line' | 'tile'

const SHAPE: Record<PressableRowVariant, string> = {
  // A row in a group's card.
  field: FIELD_ROW_PRESSABLE,
  // A row in a list of results, rounded on its own.
  list: `t-body text-primary flex min-h-(--target) w-full items-center gap-3 rounded-(--radius) px-3 text-start ${ROW_PRESS}`,
  // A secondary line inside a list row, such as the tune a recording belongs to.
  line: 't-secondary inline-flex max-w-full items-center gap-1 min-h-(--target) text-start',
  // A picture in a grid, which rises under the pointer.
  tile: `block overflow-hidden rounded-(--radius) ${PRESS}`,
}

const CHEVRON: Record<PressableRowVariant, string> = {
  field: 'text-secondary size-4 shrink-0',
  list: 'text-secondary size-4 shrink-0',
  line: 'size-4 shrink-0',
  tile: 'size-4 shrink-0',
}

interface PressableRowBase {
  variant?: PressableRowVariant
  /** A trailing chevron, for a row that opens a page or a sheet in the app. */
  chevron?: boolean
  /** The item chosen now: a trailing check, and `aria-current` on a button. */
  selected?: boolean
  /** Classes beyond the variant's shape, such as a taller inset or a text tone. */
  className?: string
  children: ReactNode
}

type AnchorProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'className' | 'children' | 'href' | 'target' | 'rel'
>

export type PressableRowProps = PressableRowBase &
  (
    | ({ to: string; href?: never } & Omit<LinkProps, 'className' | 'children' | 'to'>)
    | ({ href: string; to?: never } & AnchorProps)
    | ({ to?: never; href?: never } & Omit<AriaButtonProps, 'className' | 'children'>)
  )

/**
 * A row that opens something or picks an item: a button by default, an in-app link with `to`,
 * or a link that opens another site in a new tab with `href`, which trails an arrow out.
 */
export function PressableRow(props: PressableRowProps) {
  const { variant = 'field', chevron, selected, className = '', children, ...rest } = props
  const shape = `${SHAPE[variant]} ${className}`
  const trailing = (
    <>
      {chevron && <ChevronRight className={CHEVRON[variant]} aria-hidden />}
      {selected && <Check className="text-accent size-5 shrink-0" aria-hidden />}
    </>
  )
  if (props.to !== undefined) {
    const { to, ...link } = rest as Omit<LinkProps, 'className' | 'children'>
    return (
      <Link {...link} to={to} className={shape}>
        {children}
        {trailing}
      </Link>
    )
  }
  if (props.href !== undefined) {
    const { href, ...anchor } = rest as AnchorProps & { href: string }
    return (
      <a {...anchor} href={href} target="_blank" rel="noopener noreferrer" className={shape}>
        {children}
        {trailing}
        <ArrowUpRight className="size-4 shrink-0" aria-hidden />
      </a>
    )
  }
  const button = rest as Omit<AriaButtonProps, 'className' | 'children'>
  return (
    <AriaButton
      {...button}
      aria-current={selected || button['aria-current'] || undefined}
      data-lift={variant === 'tile' || undefined}
      className={shape}
    >
      {children}
      {trailing}
    </AriaButton>
  )
}

/**
 * A list to pick one item from, drawn as a group's rows and announced as a list of options. Its
 * rows are `PressableOption`s; the arrow keys move between them. Name it with `aria-label`, or
 * `aria-labelledby` the id of a visible heading. `selectedId` is the item chosen now.
 */
export function PressableList({
  selectedId = null,
  children,
  ...name
}: {
  selectedId?: string | null
  children: ReactNode
} & (
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-labelledby': string; 'aria-label'?: never }
)) {
  return (
    <ListBox
      {...name}
      selectionMode="single"
      selectedKeys={selectedId === null ? [] : [selectedId]}
      // The rows sit directly in the group's card, so its dividers and corners reach them.
      className="contents"
    >
      {children}
    </ListBox>
  )
}

/** One option of a `PressableList`: picking it, by pointer or key, calls `onPress`. */
export function PressableOption({
  id,
  name,
  onPress,
  isDisabled,
  className = '',
  children,
}: {
  id: string
  /** The option's accessible name. */
  name: string
  onPress: () => void
  isDisabled?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <ListBoxItem
      id={id}
      textValue={name}
      aria-label={name}
      isDisabled={isDisabled}
      onPress={onPress}
      className={`${SHAPE.field} data-[disabled]:hover:bg-transparent ${className}`}
    >
      {({ isSelected }) => (
        <>
          {children}
          {isSelected && <Check className="text-accent size-5 shrink-0" aria-hidden />}
        </>
      )}
    </ListBoxItem>
  )
}
