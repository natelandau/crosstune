import { ChevronDown } from 'lucide-react'
import { Button as AriaButton } from 'react-aria-components'
import type { TuneStatus } from '../../api/vocabulary'
import type { LiveTuneCounts } from './useStatusCounts'
import { CATALOG_SCOPE, scopeTitle } from './scope'
import { StatusScopeMenu } from './StatusScope'
import { PRESS } from '../../ui/press'

/** The phone's catalog title, which is also its status scope. */
export function StatusTitle({
  status,
  counts,
  onChoose,
}: {
  status: TuneStatus | 'all'
  counts: LiveTuneCounts | undefined
  onChoose: (status: TuneStatus | 'all') => void
}) {
  return (
    <StatusScopeMenu
      status={status}
      counts={counts}
      onChoose={onChoose}
      trigger={
        <AriaButton
          className={`-mx-1.5 inline-flex max-w-full items-center gap-1 rounded-(--radius-row) px-1.5 text-start ${PRESS} not-disabled:hover:bg-row-hover`}
        >
          <span className="truncate">{scopeTitle(CATALOG_SCOPE, status)}</span>
          <ChevronDown className="text-ink-2 size-5 shrink-0" aria-hidden />
        </AriaButton>
      }
    />
  )
}
