import type { LucideIcon } from 'lucide-react'

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
