import type { LucideIcon } from 'lucide-react'

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
