import { Music } from 'lucide-react'
import { EmptyState } from '../ui/EmptyState'

export const NO_TUNE_SELECTED = 'No tune selected'
export const CHOOSE_OR_PRESS_N = 'Choose a tune, or press N to add one'
export const CHOOSE_OR_TAP_PLUS = 'Choose a tune, or tap + to add one'
/** Recordings has no way to add a tune; a tune opens from its group heading or a row. */
export const CHOOSE_FROM_RECORDING = 'Choose a tune from a recording'

/**
 * What the wide frame's detail column shows while no tune is open. The hint is required so every
 * destination says how to fill the column, and the glyph sits at the same height in each.
 */
export function DetailEmpty({ hint }: { hint: string }) {
  return <EmptyState icon={Music} title={NO_TUNE_SELECTED} hint={hint} />
}
