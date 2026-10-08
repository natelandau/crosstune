import type { ReactElement } from 'react'
import { STATUSES, type TuneStatus } from '../../api/vocabulary'
import { STATUS_LABELS } from '../../constants'
import type { LiveTuneCounts } from './useStatusCounts'
import { countTunes } from '../selection/copy'
import { Menu, type MenuTriggerProps } from '../../ui/Menu'
import { CATALOG_SCOPE, STATUS_SCOPE } from './scope'

/**
 * The catalog's status scope: the whole catalog and each status, with each one's absolute
 * count, writing the same stored filter the sidebar rows do.
 */
export function StatusScopeMenu({
  trigger,
  status,
  counts,
  onChoose,
}: {
  trigger: ReactElement<MenuTriggerProps>
  status: TuneStatus | 'all'
  counts: LiveTuneCounts | undefined
  onChoose: (status: TuneStatus | 'all') => void
}) {
  const described = (count: number | undefined) => (count ? countTunes(count) : undefined)
  const choice = (id: TuneStatus | 'all', label: string, count: number | undefined) => ({
    id,
    label,
    description: described(count),
    checked: status === id,
    onAction: () => onChoose(id),
  })
  return (
    <Menu
      label={STATUS_SCOPE}
      choiceMode="single"
      trigger={trigger}
      items={[
        choice('all', CATALOG_SCOPE, counts?.total),
        ...STATUSES.map((value) => choice(value, STATUS_LABELS[value], counts?.byStatus[value])),
      ]}
    />
  )
}
