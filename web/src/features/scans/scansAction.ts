import { FileMusic } from 'lucide-react'
import type { RowAction } from '../../ui/Row'
import { SCANS } from './scanCopy'

/** The tune row action that opens the tune's scans, leading the row's actions, or none. */
export function scansAction(onViewScans: (() => void) | undefined): RowAction[] {
  return onViewScans ? [{ id: 'scans', label: SCANS, icon: FileMusic, onAction: onViewScans }] : []
}
