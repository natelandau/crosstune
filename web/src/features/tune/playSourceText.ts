import { Pin, PinOff } from 'lucide-react'
import type { RowAction } from '../../ui/Row'

export const PLAY_FIRST_IN_LISTS = 'Play first in lists'
export const PLAY_FIRST_SHORT = 'Play first'
export const DONT_PLAY_FIRST = "Don't play first"
export const PLAYS_FIRST = 'Plays first in lists'

/** The row action that pins a recording or link as what lists play first, or unpins it. */
export function pinRowAction(pinned: boolean, onPress: () => void): RowAction {
  return {
    label: pinned ? DONT_PLAY_FIRST : PLAY_FIRST_IN_LISTS,
    short: pinned ? undefined : PLAY_FIRST_SHORT,
    icon: pinned ? PinOff : Pin,
    tone: 'neutral',
    onPress,
  }
}
