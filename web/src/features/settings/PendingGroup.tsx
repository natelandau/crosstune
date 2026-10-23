/** The attribute a settings group still being read carries. */
export const PENDING_GROUP = 'data-pending-group'

/**
 * Stands in for a settings group while its settings are read, so a landing on a group knows
 * when every group on the page has arrived.
 */
export function PendingGroup() {
  return <div {...{ [PENDING_GROUP]: '' }} hidden />
}
