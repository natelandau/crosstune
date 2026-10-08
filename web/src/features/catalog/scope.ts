import type { TuneStatus } from '../../api/vocabulary'
import { STATUS_LABELS } from '../../constants'
import { ANY } from '../../ui/filterCopy'
import { destination } from '../../app/destinations'

/** The name of the status scope's menu, on the phone title and the filter row's Status capsule. */
export const STATUS_SCOPE = 'Status'

/** The catalog's own name, for the scope that shows every status. */
export const CATALOG_SCOPE = destination('catalog').label

/** The catalog's scope as a title: the catalog's own name, or the chosen status's label. */
export function scopeTitle(catalog: string, status: TuneStatus | 'all'): string {
  return status === 'all' ? catalog : STATUS_LABELS[status]
}

/** The Status capsule's face: "Status: Any", "Status: Learning". */
export function statusControlLabel(status: TuneStatus | 'all'): string {
  return `${STATUS_SCOPE}: ${status === 'all' ? ANY : STATUS_LABELS[status]}`
}
