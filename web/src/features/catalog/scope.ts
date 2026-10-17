import type { TuneStatus } from '../../api/vocabulary'
import { STATUS_LABELS } from '../../constants'
import { ANY } from '../../ui/filterCopy'

/** The name of the status scope's menu, on the filter row's Status capsule. */
export const STATUS_SCOPE = 'Status'

/** The Status capsule's face: "Status: Any", "Status: Learning". */
export function statusControlLabel(status: TuneStatus | 'all'): string {
  return `${STATUS_SCOPE}: ${status === 'all' ? ANY : STATUS_LABELS[status]}`
}
