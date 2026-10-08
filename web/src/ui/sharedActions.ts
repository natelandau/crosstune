import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, type LucideIcon } from 'lucide-react'
import { MOVE_DOWN, MOVE_TO_BOTTOM, MOVE_TO_TOP, MOVE_UP } from './moveMenu'
import type { MenuItem } from './menuTypes'
import type { RowAction as SharedRowAction } from './rowTypes'
import type { MenuEntry } from './Menu'
import type { RowAction } from './Row'

const TONE = { neutral: 'neutral', warning: 'warning', error: 'danger' } as const

/**
 * Menu items from a shared hook, as the menu draws them. The menu closes on every
 * choice, so a refused item runs nothing and its reason reads under its label.
 */
export function menuEntries(items: readonly MenuItem[]): MenuEntry[] {
  return items.map((item) => ({
    id: item.label,
    label: item.label,
    icon: item.icon,
    tone: TONE[item.tone ?? 'neutral'],
    description: item.disabled ?? item.refused ?? item.description,
    disabled: item.disabled !== undefined,
    checked: item.checked,
    onAction: item.refused === undefined ? item.onPress : () => {},
  }))
}

/** Row actions from a shared hook, as the row draws them. */
export function rowActions(actions: readonly SharedRowAction[]): RowAction[] {
  return actions.map((action) => ({
    id: action.label,
    label: action.label,
    shortLabel: action.short,
    icon: action.icon,
    tone: TONE[action.tone],
    onAction: action.onPress,
  }))
}

const MOVE_ICONS: Record<string, LucideIcon> = {
  [MOVE_TO_TOP]: ArrowUpToLine,
  [MOVE_UP]: ArrowUp,
  [MOVE_DOWN]: ArrowDown,
  [MOVE_TO_BOTTOM]: ArrowDownToLine,
}

/** A row's move menu items, as row menu entries each with its direction's arrow. */
export function moveActions(moves: readonly MenuItem[]): RowAction[] {
  return moves.map((move) => ({
    id: move.label,
    label: move.label,
    icon: MOVE_ICONS[move.label] ?? ArrowUp,
    onAction: move.onPress,
  }))
}
