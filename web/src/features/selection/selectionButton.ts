import type { LucideIcon } from 'lucide-react'
import type { MenuItem } from '../../ui/menuTypes'

/** One action of a selection bar: a button, or a menu when it carries `menu`. */
export interface SelectionButton {
  id: string
  label: string
  icon: LucideIcon
  /** The phone's caption, when shorter than the label it must start the label with. */
  caption?: string
  onPress?: () => void
  menu?: MenuItem[]
  /** Why the button cannot be used right now; it stays in the bar, disabled, with this reason. */
  disabled?: string
}
