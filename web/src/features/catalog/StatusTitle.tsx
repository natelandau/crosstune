import { ChevronDown } from 'lucide-react'
import { Button as AriaButton } from 'react-aria-components'
import type { TuneStatus } from '../../api/vocabulary'
import type { LiveTuneCounts } from './useStatusCounts'
import { CATALOG_SCOPE, scopeTitle } from './scope'
import { StatusScopeMenu } from './StatusScope'

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
        <AriaButton className="inline-flex max-w-full items-center gap-1 rounded-(--radius-row) text-start data-[pressed]:opacity-60">
          <span className="truncate">{scopeTitle(CATALOG_SCOPE, status)}</span>
          <ChevronDown className="text-ink-2 size-5 shrink-0" aria-hidden />
        </AriaButton>
      }
    />
  )
}
