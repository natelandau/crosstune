import type { TuneStatus } from '../../api/vocabulary'
import { STATUS_LABELS } from '../../constants'
import { ANY } from '../../ui/filterCopy'
import { destination } from '../../layout/destinations'

/** The name of the status scope's menu, on the filter row's Status capsule. */
export const STATUS_SCOPE = 'Status'

/** The catalog's own name, for the scope that shows every status. */
export const CATALOG_SCOPE = destination('catalog').label

/** The Status capsule's face: "Status: Any", "Status: Learning". */
export function statusControlLabel(status: TuneStatus | 'all'): string {
  return `${STATUS_SCOPE}: ${status === 'all' ? ANY : STATUS_LABELS[status]}`
}
